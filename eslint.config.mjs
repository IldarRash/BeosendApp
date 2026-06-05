import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.config.*",
      "**/drizzle/**",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
      "**/*.d.ts"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "warn"
    }
  },
  // Browser + React rules for the SPAs (admin console + Telegram Mini App).
  {
    files: ["apps/admin/**/*.{ts,tsx}", "apps/miniapp/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: globals.browser
    },
    rules: {
      ...reactHooks.configs.recommended.rules
    }
  }
);
