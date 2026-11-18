import { signIn } from "@/lib/auth";

export default function SignInButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="rounded-lg bg-accent px-6 py-3 text-sm font-medium text-background transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        Sign in with Google
      </button>
    </form>
  );
}
