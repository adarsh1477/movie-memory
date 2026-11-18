import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { movie: true },
  });

  if (!user?.movie) redirect("/onboarding");

  return (
    <main className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold text-text">
          Welcome, {user.name ?? user.email}
        </h1>
        <p className="text-text-muted">
          Favorite movie: <span className="text-text">{user.movie.title}</span>
        </p>
        <p className="text-xs text-text-muted">(Full dashboard — Stage 4)</p>
        <SignOutButton />
      </div>
    </main>
  );
}
