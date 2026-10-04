import { BrandMark } from "@/components/brand/BrandMark";

export function AuthShell({
  prompt,
  children,
}: {
  prompt: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm border border-slate-200 bg-white p-6">
        <div className="mb-6">
          <BrandMark size="lg" />
          <p className="mt-4 text-sm text-slate-600">{prompt}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

export const authInputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

export const authButtonClass =
  "w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50";
