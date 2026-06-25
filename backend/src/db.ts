import { resolve } from "node:path";
import { config } from "dotenv";
import pg, { type PoolClient, type QueryResultRow } from "pg";

config({ path: resolve(import.meta.dirname, "../../.env"), quiet: true });

const rawConnectionString = process.env.POSTGRES_DSN ?? process.env.DATABASE_URL;
if (!rawConnectionString) throw new Error("POSTGRES_DSN or DATABASE_URL is required");

function normalizeConnectionString(value: string) {
  const url = new URL(value);
  url.searchParams.delete("sslmode");
  return url.toString();
}

const connectionString = normalizeConnectionString(rawConnectionString);
const ssl = /localhost|127\.0\.0\.1/.test(rawConnectionString) ? false : { rejectUnauthorized: false };

export const pool = new pg.Pool({
  connectionString,
  ssl,
  min: Number(process.env.POSTGRES_POOL_MIN_SIZE ?? 0),
  max: Number(process.env.POSTGRES_POOL_MAX_SIZE ?? 10)
});

async function withClient<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("set search_path = volunteerhub, public");
    return await work(client);
  } finally {
    client.release();
  }
}

export async function all<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return withClient(async (client) => (await client.query<T>(sql, params)).rows);
}

export async function get<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return withClient(async (client) => (await client.query<T>(sql, params)).rows[0]);
}

export async function run(sql: string, params: unknown[] = []) {
  return withClient((client) => client.query(sql, params));
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("set search_path = volunteerhub, public");
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function audit(
  actorUserId: string | undefined,
  action: string,
  entityType: string,
  entityId?: string,
  details?: unknown
) {
  await run(
    `insert into audit_logs(actor_user_id, action, entity_type, module, entity_id, details)
     values ($1, $2, $3, $3, $4, $5::jsonb)`,
    [actorUserId ?? null, action, entityType, entityId ?? null, JSON.stringify(details ?? {})]
  );
}

export async function checkDatabase() {
  const result = await get<{ ok: number }>("select 1 as ok");
  return result?.ok === 1;
}
