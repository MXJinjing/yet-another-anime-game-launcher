import { describe, expect, it, vi } from "vitest";
import { RECOMMENDED_WINE_DISTRO_ID } from "@wine/distro";
import { applyRecommendedWineProgram } from "@wine/recommended-settings-program";

function setup(available: boolean) {
  const calls: string[] = [];
  const options = {
    installed: async () => available,
    effectiveDistroId: "custom",
    download: vi.fn(async function* () {
      calls.push("download");
    }),
    enable: vi.fn(async function* () {
      calls.push("enable");
    }),
  };
  return { calls, options };
}

async function run(program: AsyncIterable<unknown>) {
  for await (const command of program) void command;
}

describe("recommended Wine program", () => {
  it("downloads a missing shared Wine before enabling it", async () => {
    const { calls, options } = setup(false);
    await run(applyRecommendedWineProgram(options));
    expect(calls).toEqual(["download", "enable"]);
  });

  it("enables an installed build directly and skips an already active build", async () => {
    const { calls, options } = setup(true);
    await run(applyRecommendedWineProgram(options));
    await run(
      applyRecommendedWineProgram({
        ...options,
        effectiveDistroId: RECOMMENDED_WINE_DISTRO_ID,
      })
    );
    expect(calls).toEqual(["enable"]);
  });

  it("prepares only the separate prefix and skips a ready prefix", async () => {
    const { calls, options } = setup(true);
    const separatePrefix = {
      ready: vi.fn(async () => true),
      prepare: vi.fn(async function* (_tag: string) {
        calls.push("prepare");
      }),
    };
    await run(applyRecommendedWineProgram({ ...options, separatePrefix }));
    await run(
      applyRecommendedWineProgram({
        ...options,
        effectiveDistroId: RECOMMENDED_WINE_DISTRO_ID,
        separatePrefix,
      })
    );
    expect(calls).toEqual(["prepare"]);
    expect(separatePrefix.prepare).toHaveBeenCalledWith(
      RECOMMENDED_WINE_DISTRO_ID
    );
  });
});
