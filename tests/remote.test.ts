import { describe, expect, it } from "vitest";
import { describeBridgeError, isServerUnreachable } from "@/lib/adapters/remote";

describe("server-unreachable detection", () => {
  it.each([
    new TypeError("Failed to fetch"),
    new TypeError("fetch failed"),
    new TypeError("NetworkError when attempting to fetch resource."),
    new TypeError("Load failed"),
    new Error("both async and sync fetching of the wasm failed"),
    Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" }),
  ])("flags %s", (err) => {
    expect(isServerUnreachable(err)).toBe(true);
    expect(describeBridgeError(err)).toMatch(/npm start/);
  });

  it("leaves genuine code errors untouched", () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'id')");
    expect(isServerUnreachable(err)).toBe(false);
    expect(describeBridgeError(err)).toBe(err.message);
  });
});
