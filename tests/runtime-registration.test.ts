import { describe, expect, it } from "vitest";
import {
  CONTENT_SCRIPT_FILE,
  CONTENT_SCRIPT_ID
} from "../src/runtime/contracts";

describe("runtime registration contract", () => {
  it("uses stable identifiers for persisted Chrome registrations", () => {
    expect(CONTENT_SCRIPT_ID).toBe("tolocal-runtime");
    expect(CONTENT_SCRIPT_FILE).toBe("content-scripts/runtime.js");
  });
});
