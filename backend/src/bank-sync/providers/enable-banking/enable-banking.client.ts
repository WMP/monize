import { Injectable, Logger } from "@nestjs/common";
import {
  describeFetchFailure,
  isTransportFailure,
} from "../../../common/http/fetch-failure.util";
import { isProviderUnavailable } from "../../../provider-health/provider-unavailable.error";
import { ProviderHealthService } from "../../../provider-health/provider-health.service";
import { BankSyncProviderError } from "../bank-sync-provider.errors";
import type {
  BankAccountDescriptor,
  BankBalance,
  BankInstitution,
  BankSyncCredentials,
  BankSyncProvider,
  BankTransaction,
  PsuContext,
  StartAuthorizationInput,
} from "../bank-sync-provider.interface";
import { signEnableBankingJwt } from "./enable-banking-jwt";
import {
  mapApplication,
  mapAuthorizationUrl,
  mapBalance,
  mapInstitutions,
  mapSession,
  mapTransactionsPage,
} from "./enable-banking.mapper";

/** The id this client reports under. Must match `TRACKED_PROVIDERS`. */
export const ENABLE_BANKING_PROVIDER = "enable_banking";

/** The provider host is fixed, so no SSRF guard is needed (plan assumption 4). */
export const ENABLE_BANKING_BASE_URL = "https://api.enablebanking.com";

const REQUEST_TIMEOUT_MS = 15_000;

/** A fetch of transactions stops here; beyond it the sync fails rather than truncates. */
export const MAX_TRANSACTION_PAGES = 100;

const MAX_ERROR_CODE_LENGTH = 64;
const MAX_ERROR_DESCRIPTION_LENGTH = 200;
const MAX_ERROR_BODY_LENGTH = 4000;
const MAX_PSU_HEADER_LENGTH = 256;

/** A provider error code that says the bank consent, not the application, is the problem. */
const SESSION_ERROR_CODE = /SESSION|CONSENT|ACCESS_EXPIRED/;

interface RequestOptions {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  psu?: PsuContext | null;
  /**
   * A call made on a session's behalf (an account read). A 403 there, or a 401
   * whose code names the session, means the consent is gone; on an
   * application-level call the same statuses mean the credentials are wrong.
   */
  sessionScoped?: boolean;
  /** False for a call whose answer has no body to read (session delete). */
  readBody?: boolean;
  /** What is being done, for the one log line a transport failure earns. */
  context: string;
}

/** A header value the platform will accept: printable ASCII, bounded. */
function headerValue(value: string): string | null {
  const cleaned = value.replace(/[^ -~]+/g, " ").trim();
  return cleaned === "" ? null : cleaned.slice(0, MAX_PSU_HEADER_LENGTH);
}

/**
 * A JWT, whole or cut short: every token this client signs begins `eyJ` (the
 * base64url of `{"`) and has up to three dot-separated segments.
 */
const JWT_SHAPE = /eyJ[\w-]*(?:\.[\w-]*){0,2}/g;

/**
 * `value` with the signed token removed wherever it appears, including a copy
 * that a bounded message has cut short, which an exact match would miss.
 */
function redactToken(value: string, token: string): string {
  return value.split(token).join("[redacted]").replace(JWT_SHAPE, "[redacted]");
}

/**
 * The Enable Banking adapter, and the only place this deployment talks to
 * `api.enablebanking.com`.
 *
 * Availability goes through `ProviderHealthService` in the shape
 * `GooglePlacesClient` documents: a non-2xx is a complete answer and is
 * recorded the moment it arrives, a 2xx only once its BODY has arrived, and an
 * error the breaker did not count hands a held probe slot back.
 * `provider-call.guard.spec.ts` holds this shape.
 *
 * Every failure leaves as a `BankSyncProviderError` whose message is bounded
 * and built from the status and the provider's own error code and description
 * only. The signed JWT and the private key never reach a message or a log
 * line, and any occurrence of the token in a provider description is redacted.
 */
@Injectable()
export class EnableBankingProvider implements BankSyncProvider {
  readonly name = "enable_banking" as const;
  private readonly logger = new Logger(EnableBankingProvider.name);

  constructor(private readonly health: ProviderHealthService) {}

  async testCredentials(
    credentials: BankSyncCredentials,
  ): Promise<{ applicationName: string | null; redirectUrls: string[] }> {
    const payload = await this.request(credentials, {
      method: "GET",
      path: "/application",
      context: "credentials check",
    });
    return mapApplication(payload);
  }

  async listInstitutions(
    credentials: BankSyncCredentials,
    country: string,
  ): Promise<BankInstitution[]> {
    const payload = await this.request(credentials, {
      method: "GET",
      path: "/aspsps",
      query: { country },
      context: `institution list for ${country}`,
    });
    return mapInstitutions(payload);
  }

  async startAuthorization(
    credentials: BankSyncCredentials,
    input: StartAuthorizationInput,
  ): Promise<{ url: string }> {
    const payload = await this.request(credentials, {
      method: "POST",
      path: "/auth",
      body: {
        access: { valid_until: input.validUntil.toISOString() },
        aspsp: { name: input.institutionName, country: input.country },
        state: input.state,
        redirect_url: input.redirectUrl,
        psu_type: input.psuType,
      },
      context: "authorization start",
    });
    return { url: mapAuthorizationUrl(payload) };
  }

  async completeAuthorization(
    credentials: BankSyncCredentials,
    code: string,
  ): Promise<{
    sessionId: string;
    validUntil: Date | null;
    accounts: BankAccountDescriptor[];
  }> {
    const payload = await this.request(credentials, {
      method: "POST",
      path: "/sessions",
      body: { code },
      context: "session creation",
    });
    return mapSession(payload);
  }

  async fetchTransactions(
    credentials: BankSyncCredentials,
    externalAccountId: string,
    window: { dateFrom: string; dateTo: string },
    psu: PsuContext | null,
  ): Promise<BankTransaction[]> {
    const rows: BankTransaction[] = [];
    const seenKeys = new Set<string>();
    let continuationKey: string | null = null;

    for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
      const payload = await this.request(credentials, {
        method: "GET",
        path: `/accounts/${encodeURIComponent(externalAccountId)}/transactions`,
        query: {
          date_from: window.dateFrom,
          date_to: window.dateTo,
          transaction_status: "BOOK",
          ...(continuationKey ? { continuation_key: continuationKey } : {}),
        },
        psu,
        sessionScoped: true,
        context: "transaction fetch",
      });
      const result = mapTransactionsPage(payload);
      // Also filtered here: the status parameter is a request, not a promise.
      rows.push(...result.transactions.filter((row) => row.booked));

      if (result.continuationKey === null) return rows;
      // A key the provider hands back twice would loop for ever.
      if (seenKeys.has(result.continuationKey)) {
        throw new BankSyncProviderError(
          "invalid_response",
          "Enable Banking repeated a pagination key.",
        );
      }
      seenKeys.add(result.continuationKey);
      continuationKey = result.continuationKey;
    }
    // A partial list reported as success would advance the sync window over
    // rows never read, so running out of pages is a failure.
    throw new BankSyncProviderError(
      "invalid_response",
      `Enable Banking returned more than ${MAX_TRANSACTION_PAGES} pages of transactions.`,
    );
  }

  async fetchBalance(
    credentials: BankSyncCredentials,
    externalAccountId: string,
    psu: PsuContext | null,
  ): Promise<BankBalance | null> {
    const payload = await this.request(credentials, {
      method: "GET",
      path: `/accounts/${encodeURIComponent(externalAccountId)}/balances`,
      psu,
      sessionScoped: true,
      context: "balance fetch",
    });
    return mapBalance(payload);
  }

  async revokeSession(
    credentials: BankSyncCredentials,
    sessionId: string,
  ): Promise<void> {
    await this.request(credentials, {
      method: "DELETE",
      path: `/sessions/${encodeURIComponent(sessionId)}`,
      sessionScoped: true,
      readBody: false,
      context: "session revocation",
    });
  }

  /**
   * One authenticated call: the breaker gate, the request, the recording of
   * whichever way it ended, and the mapping of a refusal to a typed error.
   * Returns the parsed body (null when `readBody` is false).
   */
  private async request(
    credentials: BankSyncCredentials,
    options: RequestOptions,
  ): Promise<unknown> {
    // Before the breaker is consulted: a key that cannot sign is this user's
    // configuration, neither an outcome for the provider nor a probe worth holding.
    const token = signEnableBankingJwt(credentials);

    const admission = this.admit();
    const url = this.urlFor(options);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...this.psuHeaders(options.psu ?? null),
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.reportFailure(admission, options.context, error);
      throw this.transportError(error, token);
    }

    if (!response.ok) {
      // A complete answer with nothing left to trust: the provider is up.
      this.health.recordSuccess(ENABLE_BANKING_PROVIDER);
      throw await this.rejection(response, options, token);
    }

    let payload: unknown = null;
    if (options.readBody !== false) {
      try {
        payload = await response.json();
      } catch (error) {
        // A body that never finished arriving is a transport failure after the
        // headers, so it is counted here or a stalling host never opens the
        // breaker; an unparseable one is not counted at all.
        this.reportFailure(admission, options.context, error);
        throw isTransportFailure(error)
          ? this.transportError(error, token)
          : new BankSyncProviderError(
              "invalid_response",
              "Enable Banking returned an unreadable response.",
              response.status,
            );
      }
    }
    this.health.recordSuccess(ENABLE_BANKING_PROVIDER);
    return payload;
  }

  /** The breaker gate, with a refusal reported in this feature's own terms. */
  private admit(): "open-gate" | "probe" {
    try {
      return this.health.assertAvailable(ENABLE_BANKING_PROVIDER);
    } catch (error) {
      if (isProviderUnavailable(error)) {
        throw new BankSyncProviderError(
          "unavailable",
          "Enable Banking is temporarily unavailable. Try again later.",
        );
      }
      throw error;
    }
  }

  private urlFor(options: RequestOptions): string {
    const query = new URLSearchParams(options.query ?? {}).toString();
    return `${ENABLE_BANKING_BASE_URL}${options.path}${query ? `?${query}` : ""}`;
  }

  /**
   * The PSU headers of a user-present read. Values are reduced to printable
   * ASCII first: `fetch` quotes a rejected header value in its error, and a
   * user agent is the user's to choose.
   */
  private psuHeaders(psu: PsuContext | null): Record<string, string> {
    if (!psu) return {};
    const ip = headerValue(psu.ipAddress);
    const userAgent = headerValue(psu.userAgent);
    return {
      ...(ip ? { "Psu-Ip-Address": ip } : {}),
      ...(userAgent ? { "Psu-User-Agent": userAgent } : {}),
    };
  }

  /**
   * Count and log one failed attempt, and give back the probe slot when the
   * breaker did not count it. Only the probe holder may hand the slot back.
   */
  private reportFailure(
    admission: "open-gate" | "probe",
    context: string,
    error: unknown,
  ): void {
    const counted = this.health.recordFailure(ENABLE_BANKING_PROVIDER, error);
    if (!counted && admission === "probe") {
      this.health.releaseProbe(ENABLE_BANKING_PROVIDER);
    }
    this.health.logFailure(
      this.logger,
      ENABLE_BANKING_PROVIDER,
      context,
      error,
    );
  }

  private transportError(error: unknown, token: string): BankSyncProviderError {
    return new BankSyncProviderError(
      "unavailable",
      `Enable Banking did not answer: ${redactToken(describeFetchFailure(error), token)}`,
    );
  }

  /**
   * A non-2xx answer as a typed error. The provider's own `error` / `code` and
   * `message` are read from the body, bounded and stripped, because "the
   * session has expired" and "this request is malformed" send the user to
   * different repairs and a bare status cannot tell them apart.
   */
  private async rejection(
    response: Response,
    options: RequestOptions,
    token: string,
  ): Promise<BankSyncProviderError> {
    const { code, description } = await this.readError(response, token);
    const status = response.status;
    const detail =
      (code ? `: ${code}` : "") + (description ? ` (${description})` : "");
    const message = `Enable Banking returned HTTP ${status}${detail}`;

    if (status === 401 || status === 403) {
      const sessionGone =
        options.sessionScoped === true &&
        (status === 403 || (code !== null && SESSION_ERROR_CODE.test(code)));
      return new BankSyncProviderError(
        sessionGone ? "session_expired" : "unauthorized",
        message,
        status,
        code,
      );
    }
    if (status === 429) {
      return new BankSyncProviderError("rate_limited", message, status, code);
    }
    if (status >= 500) {
      return new BankSyncProviderError("unavailable", message, status, code);
    }
    if (status >= 400) {
      return new BankSyncProviderError("bad_request", message, status, code);
    }
    // A 1xx or 3xx that `fetch` did not follow: nothing this build expects.
    return new BankSyncProviderError("invalid_response", message, status, code);
  }

  private async readError(
    response: Response,
    token: string,
  ): Promise<{ code: string | null; description: string | null }> {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(
        (await response.text()).slice(0, MAX_ERROR_BODY_LENGTH),
      );
    } catch {
      // A refusal with an unreadable body is still a refusal.
    }
    const body =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    const rawCode = typeof body.error === "string" ? body.error : body.code;
    const rawDescription = body.message ?? body.error_description;
    return {
      code:
        this.safeText(rawCode, MAX_ERROR_CODE_LENGTH, token)?.toUpperCase() ??
        null,
      description: this.safeText(
        rawDescription,
        MAX_ERROR_DESCRIPTION_LENGTH,
        token,
      ),
    };
  }

  /** Printable, bounded, and never the token, wherever the provider echoed it. */
  private safeText(value: unknown, max: number, token: string): string | null {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const cleaned = redactToken(String(value), token)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim();
    return cleaned === "" ? null : cleaned.slice(0, max);
  }
}
