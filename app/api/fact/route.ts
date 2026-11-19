import { getFactForUser } from "@/lib/fact-service";
import { handle, jsonOk, requireUserId } from "@/lib/http";
import type { FactResponse } from "@/lib/validation";

// No query params (no ?force): the server alone decides freshness via the 60s window.
export async function GET() {
  return handle("GET /api/fact", async () => {
    const userId = await requireUserId();
    const { fact, stale } = await getFactForUser(userId);

    const body: FactResponse = {
      content: fact.content,
      movieTitle: fact.movieTitle,
      generatedAt: fact.createdAt.toISOString(),
      serverNow: new Date().toISOString(),
      stale,
    };
    return jsonOk(body);
  });
}
