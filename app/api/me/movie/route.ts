import { AppErrorException } from "@/lib/errors";
import { handle, jsonOk, requireUserId } from "@/lib/http";
import { loadMe } from "@/lib/me";
import { saveMovieForUser } from "@/lib/movie-service";
import { MoviePutBody, fieldErrorsOf } from "@/lib/validation";

export async function PUT(req: Request) {
  return handle("PUT /api/me/movie", async () => {
    const userId = await requireUserId();

    const raw: unknown = await req.json().catch(() => undefined);
    if (raw === undefined) {
      throw new AppErrorException({ code: "VALIDATION", message: "Request body must be JSON" });
    }

    // Unknown keys (including any client-sent userId) are stripped by the schema.
    const body = MoviePutBody.safeParse(raw);
    if (!body.success) {
      throw new AppErrorException({
        code: "VALIDATION",
        message: body.error.errors[0].message,
        fieldErrors: fieldErrorsOf(body.error),
      });
    }

    await saveMovieForUser(userId, body.data);

    const me = await loadMe(userId);
    if (!me) throw new AppErrorException({ code: "UNAUTHORIZED", message: "Sign in required" });
    return jsonOk(me);
  });
}
