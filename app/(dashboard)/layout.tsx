import { AppHeader } from "@/components/layout/AppHeader";
import { ConnectModeProvider } from "@/components/connect-mode/ConnectModeProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConnectModeProvider>
      <div className="min-h-screen">
        <AppHeader />
        {children}
      </div>
    </ConnectModeProvider>
  );
}
