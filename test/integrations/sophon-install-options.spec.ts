import { describe, expect, it } from "vitest";
import {
  resolveSophonInstallOptions,
  sophonInstallSize,
  validateSophonInstallSelection,
} from "@src/integrations/sophon-install-options";

const config = {
  launch_configs: [
    {
      game: { id: "game-id" },
      enable_scenario_pkg: true,
      scenario_pkg_info: {
        full_pkg_desc: " Full resources ",
        base_pkg_desc: " Essentials ",
      },
    },
  ],
};
const scenario = {
  full: "CATEGORY_SCENARIO_FULL",
  base: "CATEGORY_SCENARIO_BASE",
};
const shared = {
  type: "CATEGORY_TYPE_RESOURCE",
  matching_field: "common",
  scenarios: [scenario.full, scenario.base],
};
const branches = {
  game_branches: [
    {
      game: { id: "game-id" },
      main: {
        tag: "1.2.3",
        categories: [
          shared,
          shared,
          {
            type: "CATEGORY_TYPE_RESOURCE",
            matching_field: "extras",
            scenarios: [scenario.full],
          },
          {
            type: "CATEGORY_TYPE_AUDIO",
            matching_field: "en-us",
            scenarios: [],
          },
        ],
      },
    },
  ],
};
const build = {
  tag: "1.2.3",
  manifests: [
    {
      matching_field: "common",
      stats: { uncompressed_size: 70, compressed_size: 80 },
    },
    {
      matching_field: "extras",
      stats: { uncompressed_size: 100, compressed_size: 50 },
    },
    {
      matching_field: "en-us",
      stats: { uncompressed_size: 24, compressed_size: 5 },
    },
  ],
};

describe("Sophon install catalog", () => {
  const selection = {
    mode: "base",
    version: "1.2.3",
    voicePacks: ["en-us"],
  } as const;

  it("calculates both modes and adds each voice pack once", () => {
    const options = resolveSophonInstallOptions(config, branches, build);
    expect(options).toEqual({
      version: "1.2.3",
      modes: [
        { mode: "full", size: 180, description: "Full resources" },
        { mode: "base", size: 80, description: "Essentials" },
      ],
      voicePacks: [{ id: "en-us", size: 24 }],
    });
    expect(
      sophonInstallSize(options, {
        ...selection,
        voicePacks: ["en-us", "en-us"],
      })
    ).toBe(104);
    expect(sophonInstallSize(options, { ...selection, voicePacks: [] })).toBe(
      80
    );
  });

  it("offers full-only installation when the channel disables scenario packages", () => {
    const options = resolveSophonInstallOptions(
      {
        launch_configs: [
          { ...config.launch_configs[0], enable_scenario_pkg: false },
        ],
      },
      branches,
      build
    );
    expect(options.modes.map(({ mode }) => mode)).toEqual(["full"]);
    expect(() =>
      sophonInstallSize(options, { ...selection, voicePacks: [] })
    ).toThrow("changed");
  });

  it("rejects stale or inconsistent metadata instead of estimating from another build", () => {
    expect(() =>
      resolveSophonInstallOptions(config, branches, { ...build, tag: "1.2.4" })
    ).toThrow("changed");
    expect(() =>
      resolveSophonInstallOptions(
        {
          launch_configs: [
            { ...config.launch_configs[0], game: { id: "other-game" } },
          ],
        },
        branches,
        build
      )
    ).toThrow("changed");
    expect(() =>
      resolveSophonInstallOptions(config, branches, {
        ...build,
        manifests: build.manifests.slice(0, 2),
      })
    ).toThrow("unavailable");
    expect(() =>
      resolveSophonInstallOptions(config, branches, {
        ...build,
        manifests: [...build.manifests, build.manifests[0]],
      })
    ).toThrow("Invalid");
  });

  it("revalidates a queued selection against the live catalog and the saved resume plan", () => {
    const options = resolveSophonInstallOptions(config, branches, build);
    expect(() =>
      sophonInstallSize(options, { ...selection, voicePacks: ["missing"] })
    ).toThrow("unavailable");
    expect(() =>
      sophonInstallSize(options, {
        ...selection,
        version: "1.2.2",
        voicePacks: [],
      })
    ).toThrow("changed");
    const resume = { ...selection, voicePacks: ["en-us"] };
    expect(validateSophonInstallSelection({ ...options, resume }, resume)).toBe(
      104
    );
    expect(() =>
      validateSophonInstallSelection(
        { ...options, resume },
        { ...resume, voicePacks: [] }
      )
    ).toThrow("saved");
    expect(() =>
      validateSophonInstallSelection(
        { ...options, resume },
        { ...resume, voicePacks: ["ja-jp"] }
      )
    ).toThrow("saved");
  });
});
