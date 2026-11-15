import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const apps = {
  hk4ecn: "Yaaglm GI CN",
  hk4eos: "Yaaglm GI OS",
  mhyos: "Yaaglm OS",
  mhycn: "Yaaglm CN",
  all: "Yaagl",
  hkrpgcn: "Yaaglm HSR",
  hkrpgos: "Yaaglm HSR OS",
  bh3glb: "Yaaglm Honkai Global",
  cbjq: "Yaaglm SCZ OS",
  cbjqcn: "Yaaglm SCZ",
  napos: "Yaaglm ZZZ OS",
  napcn: "Yaaglm ZZZ",
};
const config = '{"version":"previous"}\n';

function withReleaseFixture(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "yaaglm-test-release-"));
  try {
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "bin"));
    for (const script of ["build-release.sh", "create-release-dmg.sh"]) {
      const file = `scripts/${script}`;
      copyFileSync(new URL(file, root), join(directory, file));
    }
    writeFileSync(join(directory, "neutralino.config.json"), config);
    writeFileSync(
      join(directory, "build-app.js"),
      `
const fs = require("node:fs");
const path = require("node:path");
const apps = ${JSON.stringify(apps)};
const app = apps[process.env.YAAGL_CHANNEL_CLIENT];
const dir = path.join("release", process.env.YAAGL_BUILD_ARCH, app + ".app");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "test-app"), process.env.YAAGL_VERSION);
`
    );
    writeFileSync(
      join(directory, "bin", "ditto"),
      '#!/usr/bin/env bash\nexec cp -R "$1" "$2"\n',
      { mode: 0o755 }
    );
    writeFileSync(
      join(directory, "bin", "hdiutil"),
      `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  create)
    shift
    while [ "$#" -gt 1 ]; do
      case "$1" in
        -quiet) shift ;;
        -format) [ "$2" = UDZO ]; shift 2 ;;
        -fs) shift 2 ;;
        -volname) volume="$2"; shift 2 ;;
        -srcfolder) payload="$2"; shift 2 ;;
        *) exit 1 ;;
      esac
    done
    test "$(readlink "$payload/Applications")" = /Applications
    cat "$payload/$volume.app/test-app" > "$1"
    ;;
  verify)
    test -s "$3"
    test "\${TEST_REJECT_DMG:-0}" = 0
    ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 }
    );
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function buildRelease(directory: string, arch: string, rejectDmg = false) {
  execFileSync("bash", ["scripts/build-release.sh"], {
    cwd: directory,
    env: {
      ...process.env,
      PATH: [join(directory, "bin"), process.env.PATH].join(delimiter),
      YAAGL_BUILD_ARCH: arch,
      YAAGL_VERSION: "1.2.3",
      TEST_REJECT_DMG: rejectDmg ? "1" : "0",
    },
  });
}

it.each(["arm64", "x64", "universal"])(
  "packages %s installers alongside the existing updater archives",
  arch => {
    withReleaseFixture(directory => {
      buildRelease(directory, arch);
      const output = join(directory, "release-assets", arch);
      const expected = Object.values(apps).flatMap(app => {
        const name = app.replaceAll(" ", ".");
        const files = [`${name}-${arch}.dmg`, `${name}.app-${arch}.tar.gz`];
        if (arch === "universal") files.push(`${name}.app.tar.gz`);
        return files;
      });
      expect(readdirSync(output).sort()).toEqual(expected.sort());
      const workflow = readFileSync(
        new URL(".github/workflows/build-ontag.yaml", root),
        "utf8"
      );
      const linked = [...workflow.matchAll(/\/([\w.-]+\.dmg)\)/g)]
        .map(([, file]) => file)
        .filter(file => file.endsWith(`-${arch}.dmg`));
      expect(linked.sort()).toEqual(
        expected.filter(file => file.endsWith(".dmg"))
      );
      expect(readFileSync(join(output, `Yaaglm.CN-${arch}.dmg`), "utf8")).toBe(
        "1.2.3"
      );
      expect(
        readFileSync(join(directory, "neutralino.config.json"), "utf8")
      ).toBe(config);
    });
  }
);

it("withholds the installer and cleans staging when image verification fails", () => {
  withReleaseFixture(directory => {
    expect(() => buildRelease(directory, "arm64", true)).toThrow();
    expect(readdirSync(join(directory, "release-assets", "arm64"))).toEqual([]);
    expect(
      readFileSync(join(directory, "neutralino.config.json"), "utf8")
    ).toBe(config);
  });
});
