import type { TaskProgram } from "@tasks/task-program";
import { resolveRecommendedWineDistro } from "./distro";
import type { WineDistribution } from "./distro";

export async function* applyRecommendedWineProgram({
  effectiveDistroId,
  installed,
  separatePrefix,
  download,
  enable,
}: {
  effectiveDistroId: string | undefined;
  installed: () => Promise<boolean>;
  separatePrefix?: {
    ready: () => Promise<boolean>;
    prepare: (tag: string) => TaskProgram;
  };
  download: (distro: WineDistribution) => TaskProgram;
  enable: (distro: WineDistribution) => TaskProgram;
}): TaskProgram {
  const distro = resolveRecommendedWineDistro();
  const available = await installed();
  const alreadySelected = effectiveDistroId === distro.id && available;
  if (separatePrefix) {
    if (!alreadySelected || !(await separatePrefix.ready())) {
      yield* separatePrefix.prepare(distro.id);
    }
    return;
  }
  if (alreadySelected) return;
  if (!available) yield* download(distro);
  yield* enable(distro);
}
