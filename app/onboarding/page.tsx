import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold text-text">
          What&apos;s your favorite movie?
        </h1>
        <p className="text-text-muted">
          (Onboarding form — Stage 3)
        </p>
      </div>
    </main>
  );
}
