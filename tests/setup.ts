import { afterEach } from "vitest";

// Unmount React trees between component tests. Loaded lazily and only in a DOM
// environment so node-environment tests (parsers, formatters) never pull in
// Testing Library or touch `document`.
afterEach(async () => {
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
