import { describe, expect, it } from "vitest";
import {
  parseBackgroundPersistedState,
  resolveInitialIndex,
} from "@src/launcher/model/background-switcher";

describe("background persisted state", () => {
  it("parses valid values and rejects invalid shapes", () => {
    expect(
      parseBackgroundPersistedState('{"ids":["a","b"],"index":1}')
    ).toEqual({ ids: ["a", "b"], index: 1 });
    expect(parseBackgroundPersistedState("{not json")).toBeNull();
    expect(parseBackgroundPersistedState('{"ids":[1],"index":0}')).toBeNull();
  });

  it("keeps a matching index and resets stale backgrounds", () => {
    expect(resolveInitialIndex({ ids: ["a", "b"], index: 1 }, ["a", "b"])).toBe(
      1
    );
    expect(resolveInitialIndex({ ids: ["a"], index: 0 }, ["a", "b"])).toBe(0);
    expect(resolveInitialIndex({ ids: ["a"], index: 2 }, ["a"])).toBe(0);
  });
});
