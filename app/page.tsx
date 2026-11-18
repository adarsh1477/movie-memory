import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignInButton from "@/components/SignInButton";

export default async function Home() {
  const session = await auth();

  if (session?.user?.id) {
    const movie = await prisma.movie.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    redirect(movie ? "/dashboard" : "/onboarding");
  }

  return (
    <main className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-4xl font-semibold text-text">Movie Memory</h1>
        <p className="text-text-muted">
          Your favorite movie, one fact at a time.
        </p>
        <SignInButton />
      </div>
    </main>
  );
}
