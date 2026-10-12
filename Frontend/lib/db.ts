import { neon, neonConfig } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable");
}

neonConfig.fetchConnectionCache = true;

const _sql = neon(process.env.DATABASE_URL);

// Detect connection-level errors worth retrying
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message + (err.cause instanceof Error ? err.cause.message : "");
  return (
    msg.includes("ETIMEDOUT") ||
    msg.includes("fetch failed") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("connecting to database")
  );
}

async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isConnectionError(err) || i === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

// Wrap sql tagged-template so every call auto-retries on timeout
export const sql = new Proxy(_sql, {
  apply(target, thisArg, args) {
    return retry(() => Reflect.apply(target, thisArg, args) as Promise<unknown>);
  },
}) as typeof _sql;

// Also export a manual withRetry for cases that need it explicitly
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  return retry(fn, attempts);
}
