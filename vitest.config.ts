import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  // WxtVitest wires up auto-imports and a fake `browser` backed by
  // @webext-core/fake-browser, so storage/permission code runs in unit tests.
  plugins: [WxtVitest()],
  test: {
    globals: true,
    setupFiles: ["tests/setup.ts"],
    // Node by default. Component tests opt into the DOM with a
    // `// @vitest-environment happy-dom` docblock at the top of the file.
    environment: "node",
    exclude: ["tests/e2e/**", "node_modules/**"]
  }
});
