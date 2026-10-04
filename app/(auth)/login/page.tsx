import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <AuthShell prompt="Sign in to monitor and control your device.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
