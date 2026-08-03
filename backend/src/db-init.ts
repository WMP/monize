import { Logger } from "@nestjs/common";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { provisionAppRole } from "./common/db/app-role";
import {
  acquireBootstrapLock,
  releaseBootstrapLock,
  type BootstrapLockOptions,
} from "./common/db/bootstrap-lock";

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

export async function initDatabase(
  options: {
    /** Overrides for the bootstrap lock wait; specs shorten it. */
    lock?: BootstrapLockOptions;
  } = {},
) {
  logger.log("Checking database initialization");

  const client = new Client({
    host: process.env.DATABASE_HOST || "localhost",
    port: parseInt(process.env.DATABASE_PORT || "5432", 10),
    user: requiredEnv("DATABASE_USER"),
    password: requiredEnv("DATABASE_PASSWORD"),
    database: requiredEnv("DATABASE_NAME"),
  });

  // Surface Postgres NOTICE/WARNING messages (e.g. the insufficient-privilege
  // warning raised when the owner cannot create the runtime role on CNPG).
  client.on("notice", (msg) => {
    if (msg?.message) {
      logger.warn(`Postgres: ${msg.message}`);
    }
  });

  let lockHeld = false;

  try {
    await client.connect();
    logger.log("Connected to database");

    // Serialize the whole check-and-act below against every other replica: the
    // "tables already exist" probe and the schema.sql that follows it are a
    // check-then-act, and two containers starting together both read "absent"
    // and both apply the schema -- the loser dies on duplicate_table and the
    // pod crash-loops. Role provisioning is inside the lock for the same
    // reason (CREATE ROLE races to duplicate_object).
    await acquireBootstrapLock(client, options.lock);
    lockHeld = true;

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
      return;
    }

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
  } catch (error) {
    logger.error(
      "Database initialization failed",
      error instanceof Error ? error.stack : String(error),
    );
    process.exit(1);
  } finally {
    if (lockHeld) {
      await releaseBootstrapLock(client);
    }
    await client.end();
  }
}

if (require.main === module) {
  initDatabase();
}
