import { describe, expect, it } from "vitest";
import { BootPerformance } from "../src/boot-performance";

describe("BootPerformance", () => {
  it("records marks and measured durations in order", async () => {
    let now = 10;
    const performance = new BootPerformance(true, () => now);
    performance.mark("script-start");
    now = 20;
    const result = await performance.measure("settings", async () => {
      now = 45;
      return 42;
    });
    now = 50;

    expect(result).toBe(42);
    expect(performance.report()).toMatchObject({
      totalMs: 40,
      entries: [
        { name: "script-start", durationMs: 0 },
        { name: "settings", durationMs: 25 },
      ],
    });
  });

  it("closes a measurement when the operation fails", async () => {
    let now = 0;
    const performance = new BootPerformance(true, () => now);
    await expect(
      performance.measure("failing", async () => {
        now = 7;
        throw new Error("failed");
      })
    ).rejects.toThrow("failed");
    expect(performance.report().entries[0]).toMatchObject({
      name: "failing",
      durationMs: 7,
    });
  });

  it("does nothing when disabled", async () => {
    const performance = new BootPerformance(false, () => 100);
    performance.mark("ignored");
    await performance.measure("ignored-too", async () => undefined);
    expect(performance.report().entries).toHaveLength(0);
  });
});
