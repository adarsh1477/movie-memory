import { signOut } from "@/lib/auth";

export default function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted transition-colors duration-150 hover:border-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        Sign out
      </button>
    </form>
  );
}
