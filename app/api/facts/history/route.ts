import type { NextRequest } from "next/server";
import { AppErrorException } from "@/lib/errors";
import { getFactHistory } from "@/lib/fact-history";
import { handle, jsonOk, requireUserId } from "@/lib/http";
import { logger } from "@/lib/logger";
import { factHistoryRateLimiter } from "@/lib/rate-limit";
import { FactHistoryQuery, fieldErrorsOf } from "@/lib/validation";

// GET /api/facts/history?limit=10&cursor=<id>. The user always comes from the session;
// any userId in the query is ignored (the schema doesn't even read it).
export async function GET(req: NextRequest) {
  return handle("GET /api/facts/history", async () => {
    const userId = await requireUserId();

    const limit = factHistoryRateLimiter.consume(userId);
    if (!limit.ok) {
      logger.info({ event: "fact_history.rate_limited", userId, retryAfterMs: limit.retryAfterMs });
      throw new AppErrorException({
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait a moment.",
        retryAfterMs: limit.retryAfterMs,
      });
    }

    const params = req.nextUrl.searchParams;
    const query = FactHistoryQuery.safeParse({ limit: params.get("limit"), cursor: params.get("cursor") });
    if (!query.success) {
      throw new AppErrorException({
        code: "VALIDATION",
        message: query.error.errors[0].message,
        fieldErrors: fieldErrorsOf(query.error),
      });
    }

    return jsonOk(await getFactHistory(userId, query.data));
  });
}
