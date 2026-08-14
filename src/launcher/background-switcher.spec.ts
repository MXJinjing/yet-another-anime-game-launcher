import { describe, expect, it } from "vitest";
import {
  parseBackgroundPersistedState,
  resolveInitialIndex,
} from "./background-switcher";

describe("parseBackgroundPersistedState", () => {
  it("parses a valid stored value", () => {
    expect(
      parseBackgroundPersistedState('{"ids":["a","b"],"index":1}')
    ).toEqual({ ids: ["a", "b"], index: 1 });
  });

  it("returns null for empty input", () => {
    expect(parseBackgroundPersistedState(null)).toBeNull();
    expect(parseBackgroundPersistedState(undefined)).toBeNull();
    expect(parseBackgroundPersistedState("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseBackgroundPersistedState("{not json")).toBeNull();
  });

  it("returns null for wrong shapes", () => {
    expect(parseBackgroundPersistedState("{}")).toBeNull();
    expect(parseBackgroundPersistedState('{"ids":[1],"index":0}')).toBeNull();
    expect(
      parseBackgroundPersistedState('{"ids":["a"],"index":"0"}')
    ).toBeNull();
  });
});

describe("resolveInitialIndex", () => {
  const ids = ["a", "b", "c"];

  it("keeps the stored index when ids match", () => {
    expect(resolveInitialIndex({ ids, index: 2 }, ids)).toBe(2);
  });

  it("resets to fallback when the background set was updated", () => {
    expect(
      resolveInitialIndex({ ids: ["a", "b", "c"], index: 2 }, ["x", "y", "z"])
    ).toBe(0);
    expect(
      resolveInitialIndex({ ids: ["a", "b"], index: 1 }, ["a", "b", "c"])
    ).toBe(0);
    expect(
      resolveInitialIndex({ ids: ["a", "b", "c"], index: 1 }, ["a", "b"])
    ).toBe(0);
  });

  it("resets to fallback when the stored index is out of range", () => {
    expect(resolveInitialIndex({ ids, index: -1 }, ids)).toBe(0);
    expect(resolveInitialIndex({ ids, index: 3 }, ids)).toBe(0);
  });

  it("resets to fallback when there is no stored state", () => {
    expect(resolveInitialIndex(null, ids)).toBe(0);
    expect(resolveInitialIndex(null, ids, 1)).toBe(1);
  });

  it("resets to fallback when there are no current backgrounds", () => {
    expect(resolveInitialIndex({ ids, index: 1 }, [])).toBe(0);
  });
});
