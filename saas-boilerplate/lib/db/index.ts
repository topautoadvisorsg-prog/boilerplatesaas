import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";
import { getEnv } from "@/lib/env";

const { DATABASE_URL } = getEnv();

// Single shared pool across requests (Neon serverless handles connection multiplexing).
const pool = new Pool({ connectionString: DATABASE_URL });

export const db = drizzle(pool, { schema, casing: "snake_case" });

export type DB = typeof db;
export { schema };
