// Signup is disabled — this is a shared demo project with a single account.
// Team members use the common demo credentials to sign in.
import { redirect } from "next/navigation";

export default function SignupPage() {
  redirect("/login");
}
