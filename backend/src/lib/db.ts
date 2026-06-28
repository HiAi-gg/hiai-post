import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "db" });

const client = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
});

export const db = drizzle(client, { schema });

export async function checkDbHealth(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    return true;
  } catch (err) {
    log.error({ err }, "Database health check failed");
    return false;
  }
}

export async function withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  return db.transaction(async (tx: any) => {
    return fn(tx);
  });
}
