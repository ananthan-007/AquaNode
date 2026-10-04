import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Static member access is required so Next.js inlines these into the Edge
// proxy bundle at build time. A helper like getSupabasePublicEnv() is
// not always rewritten, which left them undefined on Vercel.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function proxy(request: NextRequest) {
  return updateSession(request, supabaseUrl, supabaseAnonKey);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)",
  ],
};
