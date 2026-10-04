/**
 * Preservation Property Tests — LoginForm (BEFORE fix)
 *
 * Property 2: Preservation — Invalid Credentials Show Error and Never Navigate
 *
 * These tests run against the UNFIXED code and must PASS.
 * They establish the baseline: when signInWithPassword returns an error,
 * the form shows the error message and does NOT navigate to /dashboard.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as fc from "fast-check";
import { LoginForm } from "../LoginForm";

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
// Mock @/lib/supabase/client
// ---------------------------------------------------------------------------
const signInMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: signInMock,
    },
  }),
}));

// ---------------------------------------------------------------------------
// Replace window.location with a writable object once, before all tests
// ---------------------------------------------------------------------------
beforeAll(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { href: "" },
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginForm — Preservation Property (invalid credentials)", () => {
  it("Property 2: for any (email, password, errorMessage) where signInWithPassword returns an error, the form shows the error and never navigates", async () => {
    /**
     * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
     */
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 100 }).filter((s: string) => s.trim() === s && s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 200 }).filter((s: string) => s.trim() === s && s.trim().length > 0),
        async (email: string, password: string, errorMessage: string) => {
          // Reset between property runs
          cleanup();
          signInMock.mockReset();
          routerPushSpy.mockReset();
          routerRefreshSpy.mockReset();
          window.location.href = "";

          // Arrange — configure mock to return an error for this run
          signInMock.mockResolvedValueOnce({
            data: null,
            error: { message: errorMessage },
          });

          // Render fresh component
          render(<LoginForm />);

          // Act — fill in the form fields using autocomplete attribute selectors
          // (LoginForm labels lack htmlFor, so we query by autocomplete attribute)
          const emailInput = document.querySelector(
            'input[autocomplete="email"]',
          ) as HTMLInputElement;
          const passwordInput = document.querySelector(
            'input[autocomplete="current-password"]',
          ) as HTMLInputElement;
          const submitButton = screen.getByRole("button", { name: /sign in/i });

          fireEvent.change(emailInput, { target: { value: email } });
          fireEvent.change(passwordInput, { target: { value: password } });
          fireEvent.click(submitButton);

          // Wait for async handleSubmit to complete (loading state resets to false)
          await waitFor(
            () => {
              expect(screen.getByRole("button")).toHaveTextContent("Sign in");
            },
            { timeout: 3000 },
          );

          // Assert 1: error message is rendered
          expect(screen.getByText(errorMessage)).toBeInTheDocument();

          // Assert 2: window.location.href was NOT set to "/dashboard"
          expect(window.location.href).not.toBe("/dashboard");

          // Assert 3: router.push was NOT called
          expect(routerPushSpy).not.toHaveBeenCalled();

          // Assert 4: loading state reset — button shows "Sign in" (not "Signing in…")
          expect(screen.getByRole("button")).toHaveTextContent("Sign in");
        },
      ),
      { numRuns: 20, verbose: true },
    );
  });
});
