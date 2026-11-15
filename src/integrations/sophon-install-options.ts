export type SophonInstallMode = "full" | "base";

export interface SophonInstallSelection {
  mode: SophonInstallMode;
  voicePacks: string[];
  version: string;
}

interface GameIdentity {
  id: string;
}

export interface SophonConfigMetadata {
  launch_configs: {
    game: GameIdentity;
    enable_scenario_pkg: boolean;
    scenario_pkg_info?: {
      full_pkg_desc: string;
      base_pkg_desc: string;
    } | null;
  }[];
}

export interface SophonBranchMetadata {
  game_branches: {
    game: GameIdentity;
    main: {
      tag: string;
      categories: {
        type: string;
        matching_field: string;
        scenarios: string[];
      }[];
    };
  }[];
}

export interface SophonBuildMetadata {
  tag: string;
  manifests: {
    matching_field: string;
    stats: { uncompressed_size: number; compressed_size: number };
  }[];
}

export interface SophonInstallOptionsMetadata {
  version: string;
  modes: { mode: SophonInstallMode; description?: string; size: number }[];
  voicePacks: { id: string; size: number }[];
  resume?: SophonInstallSelection;
}

export function resolveSophonInstallOptions(
  configs: SophonConfigMetadata,
  branches: SophonBranchMetadata,
  build: SophonBuildMetadata
): SophonInstallOptionsMetadata {
  const config = configs.launch_configs[0];
  const entry = branches.game_branches[0];
  if (
    !config?.game.id ||
    !entry ||
    entry.game.id !== config.game.id ||
    !build.tag ||
    build.tag !== entry.main.tag
  ) {
    throw new Error("Installation metadata changed. Please try again.");
  }

  const sizes = new Map<string, number>();
  for (const manifest of build.manifests) {
    const { compressed_size, uncompressed_size } = manifest.stats;
    if (
      sizes.has(manifest.matching_field) ||
      ![compressed_size, uncompressed_size].every(
        size => Number.isSafeInteger(size) && size >= 0
      )
    ) {
      throw new Error("Invalid installation manifest size.");
    }
    sizes.set(
      manifest.matching_field,
      Math.max(compressed_size, uncompressed_size)
    );
  }

  const sizeOf = (id: string) => {
    const size = sizes.get(id);
    if (!id || size === undefined)
      throw new Error("Installation manifest size is unavailable.");
    return size;
  };
  const fields = (type: string, mode?: SophonInstallMode) => [
    ...new Set(
      entry.main.categories
        .filter(
          category =>
            category.type === type &&
            (!mode ||
              category.scenarios.includes(
                `CATEGORY_SCENARIO_${mode.toUpperCase()}`
              ))
        )
        .map(category => category.matching_field)
    ),
  ];
  const modes = (["full", "base"] as const).flatMap(mode => {
    if (mode === "base" && !config.enable_scenario_pkg) return [];
    const resources = fields("CATEGORY_TYPE_RESOURCE", mode);
    if (!resources.length) return [];
    const size = resources.reduce((total, id) => total + sizeOf(id), 0);
    if (!Number.isSafeInteger(size))
      throw new Error("Invalid installation size.");
    return [
      {
        mode,
        size,
        description:
          config.scenario_pkg_info?.[
            mode === "full" ? "full_pkg_desc" : "base_pkg_desc"
          ]?.trim(),
      },
    ];
  });
  if (!modes.some(option => option.mode === "full"))
    throw new Error("The full installation is unavailable.");

  const resourceFields = new Set(fields("CATEGORY_TYPE_RESOURCE"));
  const voicePacks = fields("CATEGORY_TYPE_AUDIO").map(id => {
    if (resourceFields.has(id))
      throw new Error("Invalid shared resource and audio manifest.");
    return { id, size: sizeOf(id) };
  });
  const maxSize =
    Math.max(...modes.map(mode => mode.size)) +
    voicePacks.reduce((total, pack) => total + pack.size, 0);
  if (!Number.isSafeInteger(maxSize))
    throw new Error("Invalid installation size.");
  return { version: build.tag, modes, voicePacks };
}

export function sophonInstallSize(
  options: SophonInstallOptionsMetadata,
  selection: SophonInstallSelection
): number {
  const mode = options.modes.find(entry => entry.mode === selection.mode);
  if (!mode || options.version !== selection.version) {
    throw new Error("Installation options changed. Please choose them again.");
  }
  let size = mode.size;
  for (const id of new Set(selection.voicePacks)) {
    const pack = options.voicePacks.find(entry => entry.id === id);
    if (!pack) throw new Error("The selected voice pack is unavailable.");
    size += pack.size;
  }
  if (!Number.isSafeInteger(size))
    throw new Error("Invalid installation size.");
  return size;
}

export function validateSophonInstallSelection(
  options: SophonInstallOptionsMetadata,
  selection: SophonInstallSelection
): number {
  if (options.resume) {
    const requested = new Set(selection.voicePacks);
    const saved = new Set(options.resume.voicePacks);
    if (
      selection.mode !== options.resume.mode ||
      requested.size !== saved.size ||
      [...requested].some(pack => !saved.has(pack))
    ) {
      throw new Error(
        "The saved installation selection changed. Please try again."
      );
    }
  }
  return sophonInstallSize(options, selection);
}
