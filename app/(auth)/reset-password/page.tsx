// Password reset is disabled — this is a shared demo project with a single account.
// Contact the project maintainer to update the demo credentials in Supabase Dashboard.
import { redirect } from "next/navigation";

export default function ResetPasswordPage() {
  redirect("/login");
}
