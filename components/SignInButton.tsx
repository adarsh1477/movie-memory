import { signIn } from "@/lib/auth";
import SignInButtonClient from "./SignInButtonClient";

export default function SignInButton({
  variant = "hero",
}: {
  variant?: "hero" | "nav";
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/" });
      }}
    >
      <SignInButtonClient variant={variant} />
    </form>
  );
}
