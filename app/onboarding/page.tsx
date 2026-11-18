import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OnboardingForm from "@/components/OnboardingForm";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const movie = await prisma.movie.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (movie) redirect("/dashboard");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 transition-all duration-200">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-text">
            What&apos;s your favorite movie?
          </h1>
          <p className="text-sm text-text-muted">
            We&apos;ll surface a fresh fact about it every minute.
          </p>
        </div>
        <OnboardingForm />
      </div>
    </main>
  );
}
