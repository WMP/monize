import { readFileSync } from "node:fs";

/**
 * What `pg` and TypeORM take as `ssl`: `false` for a plain connection, or the
 * TLS options for one that verifies (or deliberately does not verify) the
 * server. `ca` is present only when `DATABASE_SSL_CA_FILE` named a file.
 */
export type DatabaseSslConfig =
  | false
  | { rejectUnauthorized: boolean; ca?: string };

/**
 * The TLS settings every direct database connection in this process shares.
 *
 * One function rather than an inline expression per caller, because every
 * connection has to agree with the pool: the startup scripts (`db-init`,
 * `db-migrate`, `db-demo-check`) used to build their `pg.Client` with no `ssl`
 * at all and so ignored `DATABASE_SSL`, which a server that refuses non-TLS
 * clients turned into a container that crash-looped before the app started.
 * `database-ssl.guard.spec.ts` fails any file that opens a connection without
 * calling this.
 *
 * `DATABASE_SSL` is the only switch: anything but `"true"` is `false`, and
 * `DATABASE_SSL_CA_FILE` is not even read then. The CA is a path to a PEM file,
 * trusted for the database connections only -- unlike `NODE_EXTRA_CA_CERTS`,
 * which would also trust it for SMTP, S3 and OIDC. A path that is set but
 * cannot be read throws, so the boot is refused rather than falling back to
 * the system trust store and failing later with a certificate error that
 * never mentions the variable. `read` is passed in so the module can hand over
 * `ConfigService` and a spec a literal; `readFile` likewise.
 */
export function resolveDatabaseSsl(
  read: (name: string) => string | undefined,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): DatabaseSslConfig {
  if (read("DATABASE_SSL") !== "true") {
    return false;
  }
  const rejectUnauthorized =
    read("DATABASE_SSL_REJECT_UNAUTHORIZED") !== "false";
  const caPath = (read("DATABASE_SSL_CA_FILE") ?? "").trim();
  if (caPath === "") {
    // No `ca` key at all, not `ca: undefined`: the object is byte-identical to
    // what the pool and the listener built before this variable existed.
    return { rejectUnauthorized };
  }
  let ca: string;
  try {
    ca = readFile(caPath);
  } catch (error) {
    throw new Error(
      `DATABASE_SSL_CA_FILE is set to "${caPath}" but the file could not be ` +
        `read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (ca.trim() === "") {
    throw new Error(
      `DATABASE_SSL_CA_FILE is set to "${caPath}" but the file is empty. ` +
        "It must hold the PEM certificate that signed the database server's " +
        "certificate.",
    );
  }
  return { rejectUnauthorized, ca };
}
