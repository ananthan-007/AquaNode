/**
 * Bug Condition Exploration Test — Property 1
 *
 * This test encodes the EXPECTED (fixed) behavior:
 *   - After a successful signInWithPassword, window.location.href IS set to "/dashboard"
 *   - router.push IS NOT called
 *
 * On the CURRENT UNFIXED code this test is EXPECTED TO FAIL because the unfixed code
 * calls router.push("/dashboard") and never sets window.location.href.
 * That failure is the SUCCESS condition for this exploration task — it proves the bug exists.
 *
 * Validates: Requirements 1.1, 2.1, 2.2, 2.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as fc from "fast-check";
import { LoginForm } from "../LoginForm";

// ---------------------------------------------------------------------------
// Mock @/lib/supabase/client — signInWithPassword always resolves successfully
// ---------------------------------------------------------------------------
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------
const routerPushSpy = vi.fn();
const routerRefreshSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushSpy,
    refresh: routerRefreshSpy,
  }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

// ---------------------------------------------------------------------------
// Mock next/link (avoids App Router context requirement in jsdom)
// ---------------------------------------------------------------------------
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Replace window.location with a writable object so we can track href writes
// ---------------------------------------------------------------------------
let locationMock: { href: string };

beforeEach(() => {
  locationMock = { href: "" };
  Object.defineProperty(window, "location", {
    value: locationMock,
    writable: true,
    configurable: true,
  });
  routerPushSpy.mockClear();
  routerRefreshSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helper: fill and submit the form
// ---------------------------------------------------------------------------
async function fillAndSubmit(email: string, password: string) {
  // Use safe displayable values for the form inputs (raw fc values may contain
  // control chars; we just need non-empty strings to pass HTML required validation)
  const safeEmail = email.trim() || "test@example.com";
  const safePassword = password.length > 0 ? password : "password";

  // LoginForm labels don't have htmlFor; find inputs by their type instead
  const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
  const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;

  const form = emailInput.closest("form")!;
  fireEvent.change(emailInput, { target: { value: safeEmail } });
  fireEvent.change(passwordInput, { target: { value: safePassword } });
  fireEvent.submit(form);

  // Wait for the async handleSubmit to complete (loading goes false, button re-enabled)
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /sign in/i })).not.toBeDisabled();
  });
}

// ---------------------------------------------------------------------------
// Property 1: Bug Condition — Successful Login Should Use window.location.href
//
// On UNFIXED code: router.push IS called and window.location.href stays "".
// This test ASSERTS the opposite (the correct/fixed behavior), so it FAILS on
// unfixed code — that failure IS the bug proof.
// ---------------------------------------------------------------------------
describe("LoginForm — Bug Condition Exploration (Property 1)", () => {
  it("should set window.location.href to /dashboard (not router.push) on successful login", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (email: string, password: string) => {
          // Render a fresh instance per iteration
          cleanup();
          render(<LoginForm />);

          // Reset the location mock between iterations
          locationMock.href = "";
          routerPushSpy.mockClear();
          routerRefreshSpy.mockClear();

          await fillAndSubmit(email, password);

          // EXPECTED (fixed) behavior:
          //   window.location.href SHOULD be "/dashboard"  →  full-page nav flushes cookies
          //   router.push SHOULD NOT be called             →  no client-side nav
          expect(locationMock.href).toBe("/dashboard");
          expect(routerPushSpy).not.toHaveBeenCalledWith("/dashboard");
        },
      ),
      { numRuns: 5, verbose: true },
    );
  });
});
