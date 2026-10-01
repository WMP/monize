import { Logger } from "@nestjs/common";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { provisionAppRole } from "./common/db/app-role";
import { assertRuntimeRoleSafeByName } from "./common/db/runtime-role-check";
import { acquireDbLifecycleLock } from "./common/db/advisory-locks";
import { resolveDatabaseSsl } from "./common/db/database-ssl";
import { getRlsMode } from "./common/db/rls-config";

const SCHEMA_FILENAME = "schema.sql";

/**
 * db-init runs as its own process before the Nest app, but its output ends up
 * in the same container log, so it uses the Nest `Logger` (which works outside
 * an application context) rather than `console` -- otherwise the first lines of
 * every startup are the only unformatted ones in the file.
 */
const logger = new Logger("DbInit");

function requiredEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) {
    logger.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * Resolve a path and verify it stays within the given base directory.
 * Returns the resolved path or null if validation fails.
 */
function safePath(base: string, relative: string): string | null {
  const resolved = path.resolve(base, relative);
  if (
    !resolved.startsWith(path.resolve(base) + path.sep) &&
    resolved !== path.resolve(base)
  ) {
    return null;
  }
  return resolved;
}

export async function initDatabase() {
  logger.log("Checking database initialization");

  const client = new Client({
    host: process.env.DATABASE_HOST || "localhost",
    port: parseInt(process.env.DATABASE_PORT || "5432", 10),
    user: requiredEnv("DATABASE_USER"),
    password: requiredEnv("DATABASE_PASSWORD"),
    database: requiredEnv("DATABASE_NAME"),
    // The same TLS settings as the pool: a server that refuses non-TLS clients
    // would otherwise reject this connection before the app ever starts.
    ssl: resolveDatabaseSsl((name) => process.env[name]),
  });

  // Surface Postgres NOTICE/WARNING messages (e.g. the insufficient-privilege
  // warning raised when the owner cannot create the runtime role on CNPG).
  client.on("notice", (msg) => {
    if (msg?.message) {
      logger.warn(`Postgres: ${msg.message}`);
    }
  });

  try {
    await client.connect();
    logger.log("Connected to database");

    // One process at a time, across every replica. Taken before the
    // "tables already exist" check below, so a follower's check runs after the
    // winner has finished applying schema.sql rather than alongside it. Released
    // when this connection closes (the `finally` at the end, or process death).
    await acquireDbLifecycleLock(client);

    // RLS role + grants (Phase 1). Runs on EVERY startup, BEFORE the
    // "tables already exist" early return below -- placed after it, the block
    // would never run on an initialized DB and password rotation / grant
    // re-apply would silently break. Idempotent; never fatal (missing password
    // or insufficient privilege degrade to warnings) so an upgrade at
    // RLS_MODE=off is unaffected. No migration contains role or grant SQL.
    await provisionAppRole(client, {
      appUser: process.env.DATABASE_APP_USER,
      appPassword: process.env.DATABASE_APP_PASSWORD,
      logger,
    });

    // Check if tables already exist
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'users'
      );
    `);

    if (result.rows[0].exists) {
      logger.log("Database tables already exist; skipping initialization");
    } else {
      logger.log("Tables not found; initializing database");

      // Try multiple possible locations for schema.sql
      // All base directories are trusted (derived from __dirname or cwd)
      const baseDirs = [
        path.resolve(__dirname, ".."), // /app (Docker)
        path.resolve(__dirname, "..", "..", "database"), // Development
        path.resolve(process.cwd()), // Current directory
        path.resolve(process.cwd(), "..", "database"), // Parent/database
      ];

      let schemaPath: string | null = null;
      for (const base of baseDirs) {
        const candidate = safePath(base, SCHEMA_FILENAME);
        if (candidate && fs.existsSync(candidate)) {
          schemaPath = candidate;
          break;
        }
      }

      if (!schemaPath) {
        logger.error(
          [
            "schema.sql not found. Searched directories:",
            ...baseDirs.map((d) => `  - ${d}`),
          ].join("\n"),
        );
        process.exit(1);
      }

      logger.log(`Using schema from: ${schemaPath}`);
      const schema = fs.readFileSync(schemaPath, "utf8");

      await client.query(schema);
      logger.log("Database initialized successfully");
    }

    // Under enforcement, refuse to boot on a runtime role that can ignore the
    // policies. Provisioning creates a safe role, but an operator-precreated one
    // (or a managed-Postgres role) arrives with whatever attributes it was given,
    // and nothing checked -- so a role that happened to be the owner, a
    // superuser or BYPASSRLS silently turned enforcement off while every log line
    // said it was on. Fails closed, and only in `enforce`: at `off`/`shadow` the
    // runtime is the owner by design and this role may be unused.
    //
    // After the schema work, not before it, so the ownership arms interrogate
    // the database as it will actually be served rather than an empty one. And
    // through the same classifier the runtime connection uses in `main.ts`
    // (`runtime-role-check.ts`) -- a hand-written second query here once gave a
    // different verdict on the same role than the runtime check (PR #1076).
    if (getRlsMode() === "enforce") {
      await assertRuntimeRoleSafeByName(client, {
        appUser: process.env.DATABASE_APP_USER,
      });
    }
  } catch (error) {
    logger.error(
      "Database initialization failed",
      error instanceof Error ? error.stack : String(error),
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  initDatabase();
}
