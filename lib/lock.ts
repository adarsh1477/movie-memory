import { Prisma } from "@prisma/client";
import { LockTimeoutError } from "./errors";

// Must stay above the OpenAI deadline (8s) and below the tx timeout (20s).
// See docs/CONCURRENCY.md "Timeout invariant".
export const LOCK_TIMEOUT_MS = 10_000;

/**
 * Takes a transaction-scoped Postgres advisory lock on `key`, waiting up to
 * LOCK_TIMEOUT_MS, then runs `fn`. The lock is released when `tx` commits or
 * rolls back. Throws LockTimeoutError if the wait times out (SQLSTATE 55P03).
 */
export async function withAdvisoryLock<T>(
  tx: Prisma.TransactionClient,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  // SET does not accept bind parameters; the value is a constant, not user input.
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  try {
    // $executeRaw, not $queryRaw: Prisma cannot deserialize the `void` column this returns.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  } catch (err) {
    if (isLockTimeout(err)) throw new LockTimeoutError({ cause: err });
    throw err;
  }
  return fn();
}

export function isLockTimeout(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = err.meta as { code?: unknown } | undefined;
    if (meta?.code === "55P03") return true;
  }
  return err instanceof Error && /55P03|lock timeout/i.test(err.message);
}
