import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [".output/**", ".wxt/**", "node_modules/**", "coverage/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        // WXT auto-imports these in entrypoints and runtime modules.
        defineBackground: "readonly",
        defineContentScript: "readonly",
        createShadowRootUi: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  },
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    // Node tooling and manual scripts: Node + browser globals, free to log.
    files: ["tests/**", "scripts/**", "*.config.{ts,mjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.webextensions }
    },
    rules: { "no-console": "off" }
  }
);
