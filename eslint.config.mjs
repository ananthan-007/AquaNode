import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// `next lint` is deprecated as of Next.js 15 and, when no ESLint config file
// exists, falls back to an interactive "Strict / Base / Cancel" prompt. This
// file is the actual fix: a flat ESLint 9 config that reuses Next.js's own
// `eslint-config-next` rule sets via the officially documented FlatCompat
// bridge, so `eslint .` runs non-interactively with Next's real linting
// rules — not a hand-picked/looser substitute.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/sw.js",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
