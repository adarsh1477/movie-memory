import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma";
import { AppErrorException } from "./errors";
import { looksLikeRefusal } from "./openai";
import type { FactHistoryResponse } from "./validation";

/** Raw-row batches read per request while skipping refusal rows (bounds the work per call). */
const MAX_SCAN_BATCHES = 5;

type Row = { id: string; movieTitle: string; content: string; createdAt: Date };

const invalidCursor = () =>
  new AppErrorException({ code: "VALIDATION", message: "Invalid cursor", fieldErrors: { cursor: "Invalid cursor" } });

/**
 * One page of the user's fact history: newest first, ordered by (createdAt desc, id desc),
 * keyset-paginated. `userId` must come from the session.
 *
 * - The cursor is the id of the last item of the previous page. It is looked up *scoped to
 *   this user*: an unknown id, or another user's id, is "Invalid cursor" (400), so a forged
 *   cursor can never reveal anything about someone else's data.
 * - Refusal rows from older builds are skipped like everywhere else. Rows are read in
 *   batches of limit + 1 until the page is full (at most MAX_SCAN_BATCHES), so skipped rows
 *   don't shrink pages; if the cap is hit, nextCursor continues after the scanned rows.
 * - Served by the (userId, createdAt desc, id desc) index.
 */
export async function getFactHistory(
  userId: string,
  { limit, cursor }: { limit: number; cursor?: string },
  db: PrismaClient = defaultPrisma,
): Promise<FactHistoryResponse> {
  let scanAfter: Pick<Row, "id" | "createdAt"> | null = null;
  if (cursor) {
    scanAfter = await db.fact.findFirst({ where: { id: cursor, userId }, select: { id: true, createdAt: true } });
    if (!scanAfter) throw invalidCursor();
  }

  const usable: Row[] = [];
  let exhausted = false;
  for (let batch = 0; batch < MAX_SCAN_BATCHES && usable.length <= limit; batch++) {
    const after: Pick<Row, "id" | "createdAt"> | null = scanAfter;
    const rows: Row[] = await db.fact.findMany({
      where: {
        userId,
        ...(after && {
          OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }],
        }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, movieTitle: true, content: true, createdAt: true },
    });
    for (const row of rows) if (!looksLikeRefusal(row.content)) usable.push(row);
    if (rows.length < limit + 1) {
      exhausted = true;
      break;
    }
    scanAfter = rows[rows.length - 1];
  }

  const page = usable.slice(0, limit);
  let nextCursor: string | null = null;
  if (usable.length > limit) nextCursor = page[page.length - 1].id;
  else if (!exhausted && scanAfter) nextCursor = scanAfter.id; // scan cap hit: continue after the scanned rows

  return {
    items: page.map((r) => ({ id: r.id, movieTitle: r.movieTitle, content: r.content, createdAt: r.createdAt.toISOString() })),
    nextCursor,
  };
}
