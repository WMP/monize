import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import {
  DataSource,
  DeepPartial,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from "typeorm";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";

import { User } from "../users/entities/user.entity";
import { toUserProfile } from "../users/user-profile";
import { UserPreference } from "../users/entities/user-preference.entity";
import { buildDefaultPreferences } from "../users/user-preference.factory";
import { TrustedDevice } from "../users/entities/trusted-device.entity";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { derivePurposeKey, hashToken } from "./crypto.util";
import { PasswordBreachService } from "./password-breach.service";
import { EmailService } from "../notifications/email.service";
import {
  accountLockedTemplate,
  oidcLinkTemplate,
} from "../notifications/email-templates";
import { TokenService } from "./token.service";
import { TwoFactorService } from "./two-factor.service";
import { AuthEmailService } from "./auth-email.service";
import { DelegationService } from "../delegation/delegation.service";
import { BackupEncryptionService } from "../backup/backup-encryption.service";
import { withSystemContext } from "../common/db/with-context";
import { withScopedDb } from "../common/db/scoped-db";
import { returnedRows } from "../common/db/query-result";
import { tr } from "../i18n/translate";
import { currentRequestLocale } from "../i18n/request-locale";
import { I18nService } from "nestjs-i18n";
import { emailTranslator } from "../i18n/email-translator";
import { resolveUserEmailLocale } from "../i18n/resolve-user-email-locale";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private jwtSecret: string;
  /** Derived key for CSRF HMAC -- cryptographically isolated from the JWT signing key */
  private csrfKey: string;
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly BASE_LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private dataSource: DataSource,
    private passwordBreachService: PasswordBreachService,
    private emailService: EmailService,
    private tokenService: TokenService,
    private twoFactorService: TwoFactorService,
    private authEmailService: AuthEmailService,
    private delegationService: DelegationService,
    private readonly i18n: I18nService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.jwtSecret = this.configService.get<string>("JWT_SECRET")!;
    this.csrfKey = derivePurposeKey(this.jwtSecret, "csrf-token");
  }

  /**
   * One repository call in its own short scoped transaction -- the RLS-era
   * replacement for the injected repositories this class used to hold, with the
   * same autocommit boundary each of those calls had. Multi-statement units use
   * an explicit `withScopedDb` block so their statements share one transaction.
   */
  private scoped<E extends ObjectLiteral, T>(
    entity: EntityTarget<E>,
    fn: (repo: Repository<E>) => Promise<T>,
  ): Promise<T> {
    return withScopedDb(this.dataSource, (manager) =>
      fn(manager.getRepository(entity)),
    );
  }

  /** Get the derived CSRF key for use by the controller */
  getCsrfKey(): string {
    return this.csrfKey;
  }

  /**
   * Hand the just-proven password to the backup encryption service so the
   * automatic backup cron can encrypt this user's backups with it. This is the
   * only moment the server holds their password in plaintext, and the feature
   * asks them to configure nothing, so it is captured here.
   *
   * Resolved lazily via ModuleRef: BackupModule imports AuthModule, so an
   * injected dependency the other way would be a cycle. Best-effort in every
   * sense -- signing in must not fail because a backup convenience did.
   */
  private async rememberBackupPassword(
    userId: string,
    password: string,
  ): Promise<void> {
    try {
      const backupEncryption = this.moduleRef.get(BackupEncryptionService, {
        strict: false,
      });
      await backupEncryption.rememberLoginPassword(userId, password);
    } catch (err) {
      this.logger.warn(
        `Could not store the backup password for user ${userId}: ${err.message}`,
      );
    }
  }

  /**
   * Increment this user's failed-login counter in one statement and return the
   * value PostgreSQL committed.
   *
   * The returned number -- not one derived from an earlier read -- is what the
   * lockout threshold is compared against. That is the whole difference between
   * a counter that tracks the attempt rate and one that tracks how many requests
   * happened to be serialized: parallel attempts each read the pre-bcrypt value
   * and each wrote the same `1`, so the intended online-attempt limit was
   * ineffective under exactly the load it exists to defend against.
   *
   * Returns 0 when no row matched, so a caller cannot mistake a missing user for
   * a first failed attempt.
   */
  private async incrementFailedAttempts(userId: string): Promise<number> {
    const rows = await this.scoped(User, (repo) =>
      repo.query(
        `UPDATE users
            SET failed_login_attempts = failed_login_attempts + 1
          WHERE id = $1
          RETURNING failed_login_attempts`,
        [userId],
      ),
    );
    const updated = returnedRows<{ failed_login_attempts: number }>(rows);
    return updated.length > 0 ? Number(updated[0].failed_login_attempts) : 0;
  }

  // RLS: register/login/refresh/verify/OIDC lookups are public, pre-identity
  // paths -- they run with no req.user and before the RequestContextInterceptor
  // scope exists, and they must resolve or create users across the whole table
  // (login by email, OIDC by subject) before any identity is known. Seed a
  // *system* context so the downstream data access has ambient identity once
  // the repositories move to withScopedDb (task R7). This is inert until then:
  // withSystemContext only seeds AsyncLocalStorage; the injected repositories
  // still work unchanged at RLS_MODE=off.
  async register(registerDto: RegisterDto) {
    return withSystemContext(() => this.registerWithinContext(registerDto));
  }

  private async registerWithinContext(registerDto: RegisterDto) {
    const { email, password, firstName, lastName, currentPassword } =
      registerDto;

    // H7: Normalize email before lookups
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists
    const existingUser = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { email: normalizedEmail },
      }),
    );

    if (existingUser) {
      // Delegates live in the `users` table so they reuse the auth stack.
      // Registering with the same email must CLAIM (upgrade) the existing
      // delegate row -- never create a duplicate, and never overwrite a
      // row that belongs to a full account (that would be takeover).
      //
      // A row is claimable when it's a "pure delegate":
      //  - authProvider === 'local' (an OIDC user can't be claimed via a
      //    password registration),
      //  - it appears in account_delegates.delegate_user_id, and
      //  - it owns no data (no accounts, no delegations as owner, not admin).
      //
      // If the delegate row already has a password (the owner provisioned
      // it with a temp password and shared it out-of-band), the registrant
      // must prove they hold that temp password via `currentPassword`.
      // Without that proof anyone who knows the email could take over the
      // delegate row.
      const isPureDelegate =
        existingUser.authProvider === "local" &&
        (await this.delegationService.isDelegateUser(existingUser.id)) &&
        !(await this.delegationService.isFullAccount(existingUser.id));
      if (!isPureDelegate) {
        throw new ConflictException(
          tr(
            "errors.auth.unableToCompleteRegistration",
            "Unable to complete registration",
          ),
        );
      }

      if (existingUser.passwordHash) {
        // The registrant proves they hold the delegate password in one of
        // two ways: either they typed it into the dedicated "Delegate
        // password" prompt (currentPassword), or the new-account password
        // they typed up front happens to be the same value -- in which
        // case the front end doesn't need to ask for it a second time.
        const newPasswordMatches = await bcrypt.compare(
          password,
          existingUser.passwordHash,
        );
        let claimOk = newPasswordMatches;
        if (!claimOk) {
          const supplied = (currentPassword ?? "").trim();
          claimOk =
            supplied.length > 0 &&
            (await bcrypt.compare(supplied, existingUser.passwordHash));
        }
        if (!claimOk) {
          throw new UnauthorizedException(
            tr(
              "errors.auth.delegateClaimPasswordRequired",
              "An account with this email already exists as a shared user. " +
                "Provide the temporary password your administrator gave you " +
                "to claim it.",
            ),
          );
        }
      }

      const breached = await this.passwordBreachService.isBreached(password);
      if (breached) {
        throw new BadRequestException(
          tr(
            "errors.auth.passwordBreached",
            "This password has been found in a data breach. Please choose a different password.",
          ),
        );
      }

      existingUser.passwordHash = await bcrypt.hash(password, 12);
      if (firstName) existingUser.firstName = firstName;
      if (lastName) existingUser.lastName = lastName;
      existingUser.mustChangePassword = false;
      existingUser.resetToken = null;
      existingUser.resetTokenExpiry = null;
      existingUser.failedLoginAttempts = 0;
      existingUser.lockedUntil = null;
      // The row being claimed was provisioned by an account owner who invited
      // this email as a delegate, so the address is already trusted -- the
      // claimant can sign in immediately without an email-verification step.
      existingUser.emailVerified = true;
      // Promote out of the owner-managed delegate state -- the user is
      // claiming the row as their own account from here on, so they
      // should show up in admin User Management and see a "self"
      // context in the delegate banner even before they have any
      // accounts of their own.
      existingUser.isDelegateOnly = false;
      const upgraded = await this.scoped(User, (repo) =>
        repo.save(existingUser),
      );

      const { accessToken, refreshToken } =
        await this.tokenService.generateTokenPair(upgraded);
      return {
        user: this.sanitizeUser(upgraded),
        accessToken,
        refreshToken,
      };
    }

    // Check for breached password
    const isBreached = await this.passwordBreachService.isBreached(password);
    if (isBreached) {
      throw new BadRequestException(
        tr(
          "errors.auth.passwordBreached",
          "This password has been found in a data breach. Please choose a different password.",
        ),
      );
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Capture the browser-detected UI language (resolved by the proxy and
    // forwarded as x-locale) so it is persisted at account creation and the
    // user keeps it on subsequent logins instead of reverting to English.
    const language = currentRequestLocale();

    // Email verification is required only for brand-new self-service
    // registrations, and only when SMTP is configured (without it we cannot
    // deliver the link). The very first user bootstraps the instance and
    // becomes admin, so they are auto-verified -- otherwise a misconfigured
    // SMTP setup could lock the operator out of their own deployment.
    const smtpConfigured = this.emailService.getStatus().configured;

    // Raw token is kept in memory only long enough to build the email link;
    // only its hash is persisted (same pattern as password-reset tokens).
    let rawVerificationToken: string | null = null;

    // C9: Use serializable transaction to prevent race condition on first-user admin
    const { user, requireVerification } = await withScopedDb(
      this.dataSource,
      async (manager) => {
        const userCount = await manager.count(User);
        const isFirstUser = userCount === 0;
        const needsVerification = smtpConfigured && !isFirstUser;

        let emailVerificationToken: string | null = null;
        let emailVerificationTokenExpiry: Date | null = null;
        if (needsVerification) {
          rawVerificationToken = crypto.randomBytes(32).toString("hex");
          emailVerificationToken = hashToken(rawVerificationToken);
          emailVerificationTokenExpiry = new Date(
            Date.now() + 24 * 60 * 60 * 1000, // 24 hours
          );
        }

        const newUser = manager.create(User, {
          email: normalizedEmail,
          passwordHash,
          firstName,
          lastName,
          authProvider: "local",
          role: isFirstUser ? "admin" : "user",
          emailVerified: !needsVerification,
          emailVerificationToken,
          emailVerificationTokenExpiry,
        });
        const savedUser = await manager.save(newUser);
        await manager.save(buildDefaultPreferences(savedUser.id, language));
        return { user: savedUser, requireVerification: needsVerification };
      },
      // SERIALIZABLE: two concurrent first registrations must not both
      // see an empty users table and both become admin.
      "SERIALIZABLE",
    );

    // Automatic backups start encrypted from the first one, without waiting
    // for the account's first sign-in.
    await this.rememberBackupPassword(user.id, password);

    if (requireVerification) {
      // Account exists but cannot sign in until the email is verified, so we
      // deliberately do NOT issue tokens here. Hand the raw token back to the
      // controller, which owns email delivery (mirroring forgot-password).
      return {
        verificationRequired: true,
        user: this.sanitizeUser(user),
        verificationToken: rawVerificationToken!,
      };
    }

    const { accessToken, refreshToken } =
      await this.tokenService.generateTokenPair(user);

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  }

  async login(
    loginDto: LoginDto,
    trustedDeviceRef?: string,
    userAgent?: string,
  ) {
    // RLS: pre-identity path -- see the note on register(). System context.
    return withSystemContext(() =>
      this.loginWithinContext(loginDto, trustedDeviceRef, userAgent),
    );
  }

  private async loginWithinContext(
    loginDto: LoginDto,
    trustedDeviceRef?: string,
    userAgent?: string,
  ) {
    const { email: rawEmail, password, rememberMe } = loginDto;
    const email = rawEmail.toLowerCase().trim();

    const user = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { email },
      }),
    );

    if (!user || !user.passwordHash) {
      this.logger.warn("Login failed: no matching account");
      throw new UnauthorizedException(
        tr("errors.auth.invalidCredentials", "Invalid credentials"),
      );
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.logger.warn(`Login failed: account locked for user ${user.id}`);
      throw new ForbiddenException(
        tr(
          "errors.auth.accountTemporarilyLocked",
          "Account is temporarily locked due to too many failed login attempts. Please try again later.",
        ),
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      this.logger.warn(`Login failed: invalid password for user ${user.id}`);
      // Increment in SQL and derive the lockout from what the database
      // committed, not from the entity read before bcrypt ran.
      //
      // `user.failedLoginAttempts + 1` computed in application code is a
      // read-modify-write across a ~100ms bcrypt comparison -- an enormous window.
      // Five parallel invalid passwords all read 0 and all wrote 1, so the
      // persistent counter grew at a fraction of the attempt rate and the account
      // was never locked (audit P4-012). Despite the comment that used to sit
      // here, nothing about it was atomic.
      const newAttempts = await this.incrementFailedAttempts(user.id);
      const updateFields: Record<string, unknown> = {};
      if (newAttempts >= this.MAX_FAILED_ATTEMPTS) {
        const lockoutMultiplier = Math.pow(
          2,
          Math.floor(newAttempts / this.MAX_FAILED_ATTEMPTS) - 1,
        );
        const lockoutDuration = this.BASE_LOCKOUT_MS * lockoutMultiplier;
        updateFields.lockedUntil = new Date(Date.now() + lockoutDuration);
        this.logger.warn(
          `Account locked for user ${user.id} after ${newAttempts} failed attempts`,
        );
        // Fire-and-forget lockout email
        if (user.email) {
          const lang = await withScopedDb(this.dataSource, (manager) =>
            resolveUserEmailLocale(
              manager.getRepository(UserPreference),
              user.id,
            ),
          );
          const t = emailTranslator(this.i18n, lang);
          this.emailService
            .sendMail(
              user.email,
              t("emails.accountLocked.subject", "Account Temporarily Locked"),
              accountLockedTemplate(user.firstName || "", t),
            )
            .catch((err) =>
              this.logger.warn(`Failed to send lockout email: ${err.message}`),
            );
        }
      }
      if (Object.keys(updateFields).length > 0) {
        await this.scoped(User, (repo) =>
          repo
            .createQueryBuilder()
            .update(User)
            .set(updateFields)
            .where("id = :id", { id: user.id })
            .execute(),
        );
      }
      throw new UnauthorizedException(
        tr("errors.auth.invalidCredentials", "Invalid credentials"),
      );
    }

    if (!user.isActive) {
      this.logger.warn(`Login failed: account deactivated for user ${user.id}`);
      throw new UnauthorizedException(
        tr("errors.auth.accountDeactivated", "Account is deactivated"),
      );
    }

    // The password is proven correct and the account is usable: this is where
    // the plaintext exists, so this is where the backup copy is refreshed. It
    // runs before the 2FA branch because every exit below it is a successful
    // password check, and a stale copy is what produces a backup the user
    // cannot decrypt.
    await this.rememberBackupPassword(user.id, password);

    // Reset failed attempts on successful login.
    //
    // Unconditional in SQL rather than gated on the entity snapshot: a failure
    // that committed between the read and here would otherwise leave the counter
    // standing after a proven-correct password, and the old `if` could also skip
    // the reset entirely because the snapshot said there was nothing to clear.
    // A correct password is authoritative about the attempts before it.
    await this.scoped(User, (repo) =>
      repo
        .createQueryBuilder()
        .update(User)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where("id = :id", { id: user.id })
        .andWhere("(failed_login_attempts <> 0 OR locked_until IS NOT NULL)")
        .execute(),
    );

    // Hard email-verification gate: a local account that self-registered while
    // SMTP was enabled must confirm its email before it can sign in. The
    // password is already proven correct at this point, so surfacing the
    // unverified state is not an enumeration risk. Reported like requires2FA
    // (HTTP 200, no tokens) so the client can offer to resend the link.
    if (!user.emailVerified) {
      this.logger.warn(`Login blocked: email not verified for user ${user.id}`);
      return { emailNotVerified: true };
    }

    // Check if 2FA is enabled
    const preferences = await this.scoped(UserPreference, (repo) =>
      repo.findOne({
        where: { userId: user.id },
      }),
    );

    if (preferences?.twoFactorEnabled && user.twoFactorSecret) {
      // Check for trusted device
      if (trustedDeviceRef) {
        const isTrusted = await this.twoFactorService.validateTrustedDevice(
          user.id,
          trustedDeviceRef,
          userAgent,
        );
        if (isTrusted) {
          user.lastLogin = new Date();
          await this.scoped(User, (repo) => repo.save(user));
          const { accessToken, refreshToken } =
            await this.tokenService.generateTokenPair(user, rememberMe);
          this.logger.log(
            `Login successful (trusted device) for user ${user.id}`,
          );
          return {
            user: this.sanitizeUser(user),
            accessToken,
            refreshToken,
            rememberMe,
          };
        }
      }

      // Return a temporary token for 2FA verification
      // Encode rememberMe in the temp token so it survives the 2FA step
      const tempToken = this.jwtService.sign(
        { sub: user.id, type: "2fa_pending", rememberMe: !!rememberMe },
        { expiresIn: "5m" },
      );
      this.logger.log(`Login requires 2FA for user ${user.id}`);
      return { requires2FA: true, tempToken };
    }

    // Update last login
    user.lastLogin = new Date();
    await this.scoped(User, (repo) => repo.save(user));

    const { accessToken, refreshToken } =
      await this.tokenService.generateTokenPair(user, rememberMe);

    this.logger.log(`Login successful for user ${user.id}`);
    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
      rememberMe,
    };
  }

  async findOrCreateOidcUser(
    userInfo: Record<string, unknown>,
    registrationEnabled = true,
  ): Promise<{ user: User; linkPending?: boolean; isNewUser?: boolean }> {
    // RLS: pre-identity path (OIDC callback, before a session exists) that
    // looks users up by subject/email across the whole table -- see the note on
    // register(). System context.
    return withSystemContext(() =>
      this.findOrCreateOidcUserWithinContext(userInfo, registrationEnabled),
    );
  }

  private async findOrCreateOidcUserWithinContext(
    userInfo: Record<string, unknown>,
    registrationEnabled = true,
  ): Promise<{ user: User; linkPending?: boolean; isNewUser?: boolean }> {
    // Standard OIDC claims
    const sub = userInfo.sub as string;
    const rawEmail = userInfo.email as string | undefined;
    // H7: Normalize email before lookups
    const email = rawEmail?.toLowerCase().trim();
    // SECURITY: Only trust the IdP email if it is verified.
    // OIDC_REQUIRE_VERIFIED_EMAIL (default true) gates this. Set it to "false"
    // to drop the requirement: Monize then trusts the IdP-provided email even
    // without an `email_verified` claim and merges directly into an existing
    // account matching that email -- including a local password account,
    // skipping the email-confirmation step (so it works without SMTP). This
    // lowers security; only disable it when you trust your IdP to verify email
    // ownership.
    const emailVerified = userInfo.email_verified === true;
    const requireVerifiedEmail =
      this.configService
        .get<string>("OIDC_REQUIRE_VERIFIED_EMAIL")
        ?.toLowerCase() !== "false";
    const trustedEmail =
      emailVerified || !requireVerifiedEmail ? email : undefined;

    // Handle name claims - try specific claims first, fall back to 'name'
    const fullName = userInfo.name as string | undefined;
    const firstName =
      (userInfo.given_name as string) ||
      (userInfo.preferred_username as string) ||
      fullName?.split(" ")[0] ||
      undefined;
    const lastName =
      (userInfo.family_name as string) ||
      fullName?.split(" ").slice(1).join(" ") ||
      undefined;

    if (!sub) {
      throw new UnauthorizedException(
        tr(
          "errors.auth.oidcNoSubject",
          "OIDC provider did not return a subject identifier",
        ),
      );
    }

    let user = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { oidcSubject: sub },
      }),
    );
    // True only when this call provisions the account, so the callback can
    // send an SSO user through the same first-run preferences step local
    // registration ends on. Linking an OIDC identity to an account that
    // already exists is not a first run.
    let isNewUser = false;

    if (!user) {
      // SECURITY: Only link to existing account if email is verified by OIDC provider
      // M6: If the existing account has a password (local account), require confirmation
      if (trustedEmail) {
        const existingUser = await this.scoped(User, (repo) =>
          repo.findOne({
            where: { email: trustedEmail },
          }),
        );

        if (existingUser) {
          if (existingUser.passwordHash && requireVerifiedEmail) {
            // SECURITY: Local account requires user confirmation before merging.
            const linkToken = await this.initiateOidcLink(existingUser, sub);
            this.logger.warn(
              `OIDC link pending confirmation for user ${existingUser.id}`,
            );
            await this.sendOidcLinkEmail(existingUser, linkToken);
            return { user: existingUser, linkPending: true };
          } else {
            // OIDC-only account, or OIDC_REQUIRE_VERIFIED_EMAIL=false bypasses
            // the confirmation step -- merge the OIDC identity in directly.
            existingUser.oidcSubject = sub;
            existingUser.authProvider = "oidc";
            await this.scoped(User, (repo) => repo.save(existingUser));
            user = existingUser;
          }
        }
      }

      if (!user) {
        if (!registrationEnabled) {
          throw new ForbiddenException(
            tr(
              "errors.auth.registrationDisabled",
              "New account registration is disabled.",
            ),
          );
        }
        // Persist the browser-detected UI language at account creation (same
        // rationale as local registration) so SSO users also keep their
        // language across logins.
        const language = currentRequestLocale();

        // C9: Use serializable transaction for first-user admin race prevention
        try {
          user = await withScopedDb(
            this.dataSource,
            async (manager) => {
              const userCount = await manager.count(User);
              const userData: DeepPartial<User> = {
                email: trustedEmail ?? email ?? null,
                firstName: firstName ?? null,
                lastName: lastName ?? null,
                oidcSubject: sub,
                authProvider: "oidc",
                role: userCount === 0 ? "admin" : "user",
                // OIDC identities are verified by the provider and never use
                // the local-login gate; create them already verified.
                emailVerified: true,
              };
              const newUser = manager.create(User, userData);
              const savedUser = await manager.save(newUser);
              await manager.save(
                buildDefaultPreferences(savedUser.id, language),
              );
              return savedUser;
            },
            "SERIALIZABLE",
          );
          isNewUser = true;
        } catch (err: any) {
          // Handle duplicate email: link OIDC to the existing account
          if (err.code === "23505" && trustedEmail) {
            const existingUser = await this.scoped(User, (repo) =>
              repo.findOne({
                where: { email: trustedEmail },
              }),
            );
            if (existingUser) {
              if (existingUser.passwordHash && requireVerifiedEmail) {
                // SECURITY: Local account requires confirmation
                const linkToken = await this.initiateOidcLink(
                  existingUser,
                  sub,
                );
                this.logger.warn(
                  `OIDC link pending confirmation (catch path) for user ${existingUser.id}`,
                );
                await this.sendOidcLinkEmail(existingUser, linkToken);
                return { user: existingUser, linkPending: true };
              } else {
                // OIDC-only account, or OIDC_REQUIRE_VERIFIED_EMAIL=false --
                // merge directly
                existingUser.oidcSubject = sub;
                existingUser.authProvider = "oidc";
                await this.scoped(User, (repo) => repo.save(existingUser));
                user = existingUser;
              }
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }
      }
    } else {
      // Update user info if it has changed (but don't overwrite with null)
      let needsUpdate = false;

      // Ensure authProvider reflects OIDC usage
      if (user.authProvider !== "oidc") {
        user.authProvider = "oidc";
        needsUpdate = true;
      }

      // SECURITY: Only update email if verified by OIDC provider
      if (trustedEmail && user.email !== trustedEmail) {
        user.email = trustedEmail;
        needsUpdate = true;
      }
      if (firstName && user.firstName !== firstName) {
        user.firstName = firstName;
        needsUpdate = true;
      }
      if (lastName && user.lastName !== lastName) {
        user.lastName = lastName;
        needsUpdate = true;
      }

      if (needsUpdate) {
        const toSave = user;
        await this.scoped(User, (repo) => repo.save(toSave));
      }
    }

    // Strip any 2FA config from SSO users -- 2FA is managed by the identity provider
    if (
      user.twoFactorSecret ||
      user.pendingTwoFactorSecret ||
      user.backupCodes
    ) {
      user.twoFactorSecret = null;
      user.pendingTwoFactorSecret = null;
      user.backupCodes = null;
      this.logger.log(`Cleared 2FA config for SSO user ${user.id}`);

      const preferences = await this.scoped(UserPreference, (repo) =>
        repo.findOne({
          where: { userId: user.id },
        }),
      );
      if (preferences && preferences.twoFactorEnabled) {
        preferences.twoFactorEnabled = false;
        await this.scoped(UserPreference, (repo) => repo.save(preferences));
      }

      await this.scoped(TrustedDevice, (repo) =>
        repo.delete({ userId: user.id }),
      );
    }

    // Update last login
    user.lastLogin = new Date();
    await this.scoped(User, (repo) => repo.save(user));

    return { user, isNewUser };
  }

  async validateOidcUser(profile: any): Promise<any> {
    const result = await this.findOrCreateOidcUser(profile);
    return this.sanitizeUser(result.user);
  }

  async getUserById(id: string): Promise<User | null> {
    return this.scoped(User, (repo) => repo.findOne({ where: { id } }));
  }

  /**
   * Returns whether the given user has 2FA enabled. Lets the Security UI
   * (including a delegate managing their own credentials) read the
   * authenticated user's 2FA state without exposing the secret.
   */
  async is2FAEnabled(userId: string): Promise<boolean> {
    const prefs = await this.scoped(UserPreference, (repo) =>
      repo.findOne({
        where: { userId },
      }),
    );
    return !!prefs?.twoFactorEnabled;
  }

  async getUserStateById(
    id: string,
  ): Promise<Pick<
    User,
    "id" | "isActive" | "mustChangePassword" | "role"
  > | null> {
    return this.scoped(User, (repo) =>
      repo.findOne({
        where: { id },
        select: ["id", "isActive", "mustChangePassword", "role"],
      }),
    );
  }

  // M6: OIDC account linking with confirmation

  async initiateOidcLink(
    existingUser: User,
    oidcSubject: string,
  ): Promise<string> {
    const linkToken = crypto.randomBytes(32).toString("hex");
    existingUser.oidcLinkToken = hashToken(linkToken);
    existingUser.oidcLinkExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    existingUser.oidcLinkPending = true;
    existingUser.pendingOidcSubject = oidcSubject;
    await this.scoped(User, (repo) => repo.save(existingUser));
    return linkToken;
  }

  private async sendOidcLinkEmail(
    user: User,
    linkToken: string,
  ): Promise<void> {
    if (!user.email) return;
    try {
      const frontendUrl =
        this.configService.get<string>("PUBLIC_APP_URL") ||
        "http://localhost:3000";
      const confirmUrl = `${frontendUrl}/api/v1/auth/oidc/confirm-link?token=${linkToken}`;
      const lang = await withScopedDb(this.dataSource, (manager) =>
        resolveUserEmailLocale(manager.getRepository(UserPreference), user.id),
      );
      const t = emailTranslator(this.i18n, lang);
      const html = oidcLinkTemplate(user.firstName || "", confirmUrl, t);
      await this.emailService.sendMail(
        user.email,
        t("emails.oidcLink.subject", "Monize: Confirm SSO Account Link"),
        html,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send OIDC link confirmation email: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async confirmOidcLink(token: string): Promise<User> {
    // RLS: public link-confirmation route (email token, no req.user). Looks up
    // the pending user by hashed link token across the table. System context.
    return withSystemContext(() => this.confirmOidcLinkWithinContext(token));
  }

  private async confirmOidcLinkWithinContext(token: string): Promise<User> {
    const hashedToken = hashToken(token);

    const user = await this.scoped(User, (repo) =>
      repo.findOne({
        where: { oidcLinkToken: hashedToken, oidcLinkPending: true },
      }),
    );

    if (!user) {
      throw new BadRequestException(
        tr(
          "errors.auth.invalidOrExpiredLinkToken",
          "Invalid or expired link token",
        ),
      );
    }

    if (user.oidcLinkExpiresAt && user.oidcLinkExpiresAt < new Date()) {
      // Clear expired linking data
      user.oidcLinkPending = false;
      user.oidcLinkToken = null;
      user.oidcLinkExpiresAt = null;
      user.pendingOidcSubject = null;
      await this.scoped(User, (repo) => repo.save(user));
      throw new BadRequestException(
        tr("errors.auth.linkTokenExpired", "Link token has expired"),
      );
    }

    // Complete the link
    user.oidcSubject = user.pendingOidcSubject;
    user.authProvider = "oidc";
    user.oidcLinkPending = false;
    user.oidcLinkToken = null;
    user.oidcLinkExpiresAt = null;
    user.pendingOidcSubject = null;
    await this.scoped(User, (repo) => repo.save(user));

    return user;
  }

  /**
   * Public profile shape for a `users` row. Delegates to the one audited
   * allowlist so login, `/auth/profile`, `/users/me` and the admin surfaces
   * cannot drift apart -- they did, and the shortest list forgot the most.
   */
  sanitizeUser(user: User) {
    return toUserProfile(user);
  }

  // --- Delegated methods (preserve public API for controller/strategies) ---

  async generateTokenPair(user: User, rememberMe?: boolean) {
    return this.tokenService.generateTokenPair(user, rememberMe);
  }

  async refreshTokens(rawRefreshToken: string) {
    // RLS: public token-refresh path (raw refresh token, no req.user yet).
    return withSystemContext(() =>
      this.tokenService.refreshTokens(rawRefreshToken),
    );
  }

  async revokeRefreshToken(rawRefreshToken: string) {
    return this.tokenService.revokeRefreshToken(rawRefreshToken);
  }

  async revokeAllUserRefreshTokens(userId: string) {
    return this.tokenService.revokeAllUserRefreshTokens(userId);
  }

  async verify2FA(
    tempToken: string,
    code: string,
    rememberDevice = false,
    userAgent?: string,
    ipAddress?: string,
  ) {
    // RLS: public 2FA-completion path (temp token identifies the user, but no
    // req.user exists yet). System context.
    return withSystemContext(() =>
      this.twoFactorService.verify2FA(
        tempToken,
        code,
        rememberDevice,
        userAgent,
        ipAddress,
      ),
    );
  }

  async setup2FA(userId: string, currentPassword: string) {
    return this.twoFactorService.setup2FA(userId, currentPassword);
  }

  async confirmSetup2FA(userId: string, code: string) {
    return this.twoFactorService.confirmSetup2FA(userId, code);
  }

  async disable2FA(userId: string, code: string) {
    return this.twoFactorService.disable2FA(userId, code);
  }

  async generateBackupCodes(userId: string, code: string) {
    return this.twoFactorService.generateBackupCodes(userId, code);
  }

  async getTrustedDevices(userId: string) {
    return this.twoFactorService.getTrustedDevices(userId);
  }

  async revokeTrustedDevice(userId: string, deviceId: string) {
    return this.twoFactorService.revokeTrustedDevice(userId, deviceId);
  }

  async revokeAllTrustedDevices(userId: string) {
    return this.twoFactorService.revokeAllTrustedDevices(userId);
  }

  async findTrustedDeviceByToken(userId: string, deviceToken: string) {
    return this.twoFactorService.findTrustedDeviceByToken(userId, deviceToken);
  }

  async createTrustedDevice(
    userId: string,
    userAgent: string,
    ipAddress?: string,
  ) {
    return this.twoFactorService.createTrustedDevice(
      userId,
      userAgent,
      ipAddress,
    );
  }

  async validateTrustedDevice(
    userId: string,
    deviceToken: string,
    userAgent?: string,
  ) {
    return this.twoFactorService.validateTrustedDevice(
      userId,
      deviceToken,
      userAgent,
    );
  }

  async migrateLegacyTotpSecrets() {
    return this.twoFactorService.migrateLegacyTotpSecrets();
  }

  async purgeExpiredRefreshTokens() {
    return this.tokenService.purgeExpiredRefreshTokens();
  }

  async generateResetToken(email: string) {
    // RLS: public forgot-password path (email lookup, no req.user).
    return withSystemContext(() =>
      this.authEmailService.generateResetToken(email),
    );
  }

  async resetPassword(token: string, newPassword: string) {
    // RLS: public reset-password path (reset token, no req.user).
    return withSystemContext(() =>
      this.authEmailService.resetPassword(token, newPassword),
    );
  }

  checkForgotPasswordEmailLimit(email: string) {
    return this.authEmailService.checkForgotPasswordEmailLimit(email);
  }

  async generateVerificationToken(email: string) {
    // RLS: public resend-verification path (email lookup, no req.user).
    return withSystemContext(() =>
      this.authEmailService.generateVerificationToken(email),
    );
  }

  async verifyEmail(token: string) {
    // RLS: public verify-email path (verification token, no req.user).
    return withSystemContext(() => this.authEmailService.verifyEmail(token));
  }

  checkVerificationEmailLimit(email: string) {
    return this.authEmailService.checkVerificationEmailLimit(email);
  }
}
