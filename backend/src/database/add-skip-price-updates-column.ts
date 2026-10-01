/**
 * Add skip_price_updates column to securities table.
 *
 * This column is used to mark auto-generated securities that should not have
 * their prices updated from external sources.
 *
 * Run with: npx ts-node -r tsconfig-paths/register src/database/add-skip-price-updates-column.ts
 */

import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import * as dotenv from "dotenv";
import * as path from "path";
import { resolveDatabaseSsl } from "../common/db/database-ssl";

dotenv.config({ path: path.join(__dirname, "../../../.env") });

const logger = new Logger("AddSkipPriceUpdatesColumn");

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  logger.error(`Missing required environment variable: ${names.join(" or ")}`);
  process.exit(1);
}

async function addSkipPriceUpdatesColumn() {
  const dataSource = new DataSource({
    type: "postgres",
    host: process.env.DATABASE_HOST || "localhost",
    port: parseInt(process.env.DATABASE_PORT || "5432"),
    username: requiredEnv("DATABASE_USER", "POSTGRES_USER"),
    password: requiredEnv("DATABASE_PASSWORD", "POSTGRES_PASSWORD"),
    database: requiredEnv("DATABASE_NAME", "POSTGRES_DB"),
    ssl: resolveDatabaseSsl((name) => process.env[name]),
  });

  await dataSource.initialize();
  logger.log("Database connected");

  try {
    // Check if column already exists
    const columnExists = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'securities' AND column_name = 'skip_price_updates'
    `);

    if (columnExists.length > 0) {
      logger.log("Column skip_price_updates already exists");
      return;
    }

    // Add the column
    await dataSource.query(`
      ALTER TABLE securities
      ADD COLUMN skip_price_updates BOOLEAN NOT NULL DEFAULT false
    `);

    logger.log("Added skip_price_updates column to securities table");
  } finally {
    await dataSource.destroy();
  }
}

addSkipPriceUpdatesColumn().catch((error) =>
  logger.error(
    "Failed to add skip_price_updates column",
    error instanceof Error ? error.stack : String(error),
  ),
);
