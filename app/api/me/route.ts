import { AppErrorException } from "@/lib/errors";
import { handle, jsonOk, requireUserId } from "@/lib/http";
import { loadMe } from "@/lib/me";

export async function GET() {
  return handle("GET /api/me", async () => {
    const userId = await requireUserId();
    const me = await loadMe(userId);
    // A session whose user row was deleted is treated as signed out.
    if (!me) throw new AppErrorException({ code: "UNAUTHORIZED", message: "Sign in required" });
    return jsonOk(me);
  });
}
