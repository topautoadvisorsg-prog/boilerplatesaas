/**
 * Apply RLS policies. Run AFTER drizzle migrations.
 *   pnpm db:migrate && pnpm db:rls
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED is required.");
  process.exit(1);
}

const sql = readFileSync(resolve(process.cwd(), "drizzle/rls.sql"), "utf8");

const pool = new Pool({ connectionString: url });

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("RLS policies applied.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
