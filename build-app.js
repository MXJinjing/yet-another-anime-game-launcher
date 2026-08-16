const execa = require("execa");
const crypto = require("crypto");
const fs = require("fs-extra");
const path = require("path");
const { rimraf } = require("rimraf");
const { IconIcns } = require("@shockpkg/icon-encoder");

(async () => {
  const icns = new IconIcns();
  const raw = true;

  await execa("cp", ["neutralino.config.json", "neutralino.config.json.bak"]);
  // build done read neutralino.config.js file
  const config = await fs.readJSON(
    path.resolve(process.cwd(), "neutralino.config.json")
  );
  let bundleId;
  let appDistributionName;
  let includeSophon = false;
  const channel = process.env["YAAGL_CHANNEL_CLIENT"] ?? "mhycn";
  switch (channel) {
    case "hk4ecn":
      bundleId = config.applicationId;
      appDistributionName = config.cli.binaryName;
      includeSophon = true;
      break;
    case "hk4eos":
      bundleId = config.applicationId + ".os";
      appDistributionName = config.cli.binaryName + " OS";
      includeSophon = true;
      break;
    case "mhyos":
      bundleId = config.applicationId + ".os";
      appDistributionName = "Yaaglm OS";
      config.modes.window.title = "Yaaglm OS";
      includeSophon = true;
      break;
    case "mhycn":
      bundleId = config.applicationId + ".cn";
      appDistributionName = "Yaaglm CN";
      config.modes.window.title = "Yaaglm CN";
      includeSophon = true;
      break;
    case "hk4euniversal":
      bundleId = config.applicationId + ".uni";
      appDistributionName = config.cli.binaryName + " Uni";
      includeSophon = true;
      break;
    case "hkrpgcn":
      bundleId = config.applicationId + ".hkrpg.cn";
      appDistributionName = config.cli.binaryName + " HSR";
      config.modes.window.icon = "/src/assets/March7th.cr.png";
      break;
    case "hkrpgos":
      bundleId = config.applicationId + ".hkrpg.os";
      appDistributionName = config.cli.binaryName + " HSR OS";
      config.modes.window.icon = "/src/assets/March7th.cr.png";
      break;
    case "bh3glb":
      bundleId = config.applicationId + ".bh3.glb";
      appDistributionName = config.cli.binaryName + " Honkai Global";
      config.modes.window.icon = "/src/assets/Elysia.cr.png";
      break;
    case "cbjq":
      bundleId = config.applicationId + ".scz.os";
      appDistributionName = config.cli.binaryName + " SCZ OS";
      break;
    case "cbjqcn":
      bundleId = config.applicationId + ".scz.cn";
      appDistributionName = config.cli.binaryName + " SCZ";
      break;
    case "napos":
      bundleId = config.applicationId + ".nap.os";
      appDistributionName = config.cli.binaryName + " ZZZ OS";
      config.modes.window.icon = "/src/assets/ZZZ_Bang.cr.png";
      break;
    case "napcn":
      bundleId = config.applicationId + ".nap.cn";
      appDistributionName = config.cli.binaryName + " ZZZ";
      config.modes.window.icon = "/src/assets/ZZZ_Bang.cr.png";
      break;
    default:
      throw new Error(`Unknown YAAGL_CHANNEL_CLIENT: ${channel}`);
  }
  if (process.env["YAAGL_TEST"]) {
    bundleId += ".test";
    appDistributionName += " Test";
  }
  await fs.writeJSON(
    path.resolve(process.cwd(), "neutralino.config.json"),
    config
  );
  try {
    await execa("./node_modules/.bin/tsc"); // do typecheck first
    await execa("rm", ["-rf", "./.tmp"]);
    await execa("./node_modules/.bin/vite", ["build"]);
    await execa("cp", ["./neutralino.js", "./dist/neutralino.js"]);
    // run neu build command
    await execa("./node_modules/.bin/neu", ["build"]);
  } finally {
    await execa("mv", [
      "-f",
      "neutralino.config.json.bak",
      "neutralino.config.json",
    ]);
  }

  const appname = config.cli.binaryName;
  const buildArch = process.env["YAAGL_BUILD_ARCH"] ?? "arm64";
  if (!new Set(["arm64", "x64", "universal"]).has(buildArch)) {
    throw new Error(`Unknown YAAGL_BUILD_ARCH: ${buildArch}`);
  }
  const binaryName = `${config.cli.binaryName}-mac_${buildArch}`;
  const releaseDir = path.resolve(process.cwd(), "release", buildArch);
  const appBundlePath = path.resolve(
    releaseDir,
    `${appDistributionName}.app`
  );

  // read package.json
  const pkg = await fs.readJSON(path.resolve(process.cwd(), "package.json"));
  // Keep every generated app under its architecture-specific release folder.
  await fs.ensureDir(releaseDir);
  await rimraf(appBundlePath);
  await fs.mkdir(appBundlePath);
  await fs.mkdir(path.resolve(appBundlePath, "Contents"));
  await fs.mkdir(
    path.resolve(
      appBundlePath,
      "Contents",
      "MacOS"
    )
  );
  await fs.mkdir(
    path.resolve(
      appBundlePath,
      "Contents",
      "Resources"
    )
  );
  await fs.mkdir(
    path.resolve(
      appBundlePath,
      "Contents",
      "Resources",
      ".storage"
    )
  );
  // move binary to app folder
  await fs.move(
    path.resolve(process.cwd(), "dist", appname, binaryName),
    path.resolve(
      appBundlePath,
      "Contents",
      "MacOS",
      binaryName
    )
  );
  await fs.rename(
    path.resolve(
      appBundlePath,
      "Contents",
      "MacOS",
      binaryName
    ),
    path.resolve(
      appBundlePath,
      "Contents",
      "MacOS",
      appname
    )
  );

  // move res.neu or resources.neu to app folder
  const resources = fs.readdirSync(
    path.resolve(process.cwd(), "dist", appname)
  );
  const resourcesFile = resources.find(file => /res(ources)?/.test(file));
  await fs.copy(
    path.resolve(process.cwd(), "dist", appname, resourcesFile),
    path.resolve(
      appBundlePath,
      "Contents",
      "Resources",
      resourcesFile
    )
  );

  // check if file exists
  if (fs.existsSync(path.join(process.cwd(), config.modes.window.icon))) {
    const iconFile = await fs.readFile(
      path.join(process.cwd(), config.modes.window.icon)
    );
    icns.addFromPng(iconFile, ["ic09"], raw);
    // icns.addFromPng(iconFile, ['ic07'], raw);
    // icns.addFromPng(iconFile, ['ic08'], raw);
    // icns.addFromPng(iconFile, ['ic04'], raw);
    // icns.addFromPng(iconFile, ['ic09'], raw);
    // icns.addFromPng(iconFile, ['ic05'], raw);
    // icns.addFromPng(iconFile, ['ic12'], raw);
    // icns.addFromPng(iconFile, ['ic13'], raw);
    // icns.addFromPng(iconFile, ['ic14'], raw);
    // icns.addFromPng(iconFile, ['ic10'], raw);
    // icns.addFromPng(iconFile, ['ic11'], raw);
  }
  // save icns file
  await fs.writeFile(
    path.resolve(
      appBundlePath,
      "Contents",
      "Resources",
      "icon.icns"
    ),
    icns.encode()
  );

  // create an empty icon file in the app folder
  // await fs.ensureFile(
  //   path.resolve(appBundlePath, "Icon")
  // );

  //
  await fs.writeFile(
    path.resolve(
      appBundlePath,
      "Contents",
      "MacOS",
      "parameterized"
    ),
    `#!/usr/bin/env bash
SCRIPT_DIR="$( cd -- "$( dirname -- "\${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
APST_DIR="$HOME/Library/Application Support/${appDistributionName}"
echo $APST_DIR
mkdir -p "$APST_DIR"
CONTENTS_DIR="$(dirname "$SCRIPT_DIR")"
rsync -rlptu "$CONTENTS_DIR/Resources/." "$APST_DIR"
cd "$APST_DIR"
export YAAGL_BUNDLE_PATH="$(dirname "$CONTENTS_DIR")"
PATH_LAUNCH="$(dirname "$CONTENTS_DIR")" exec "$SCRIPT_DIR/${appname}" --path="$APST_DIR"`
  );

  await fs.chmod(
    path.resolve(
      appBundlePath,
      "Contents",
      "MacOS",
      "parameterized"
    ),
    0o755
  );
  await fs.chmod(
    path.resolve(
      appBundlePath,
      "Contents",
      "MacOS",
      appname
    ),
    0o755
  );
  // copy sidecar
  const sidecarDst = path.resolve(
    appBundlePath,
    `Contents`,
    `Resources`,
    `sidecar`
  );
  // copy sophon binary to sidecar
  if (includeSophon) {
    await fs.copy(
      path.resolve(process.cwd(), `sophon_server`, `build`, `server.dist`),
      path.resolve(sidecarDst, `sophon_server`), {
      preserveTimestamps: true,
    });
  }
  // Remove potentially existing dev sophon_server from sidecar
  await fs.remove(path.resolve(process.cwd(), `sidecar`, `sophon_server`));
  // The hosts-helper binary is prebuilt (universal arm64/x86_64) from the
  // separate yaaglm-hosts-helper project and committed under sidecar/; it is
  // not compiled here anymore.
  await fs.copy(path.resolve(process.cwd(), `sidecar`), sidecarDst, {
    preserveTimestamps: true,
  });
  // Remove protonextras for hkrpg
  if (["hkrpgcn", "hkrpgos"].includes(process.env["YAAGL_CHANNEL_CLIENT"])) {
    await fs.remove(path.resolve(sidecarDst, "protonextras"));
  }

  await (async function getFiles(dir) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(
      dirents.map(dirent => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory()
          ? getFiles(res)
          : dirent.isFile()
            ? dirent.name.split(".").length == 1
              ? fs.chmod(res, 0o755).then(() => {
                console.log("chmod +x " + res);
              })
              : Promise.resolve()
            : Promise.resolve();
      })
    );
  })(sidecarDst);

  // chmod executable
  // create info.plist file
  await fs.writeFile(
    path.resolve(
      appBundlePath,
      "Contents",
      "Info.plist"
    ),
    `<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
        <key>NSHighResolutionCapable</key>
        <true/>
        <key>CFBundleExecutable</key>
        <string>parameterized</string>
        <key>CFBundleIconFile</key>
        <string>icon.icns</string>
        <key>CFBundleIdentifier</key>
        <string>${bundleId}</string>
        <key>CFBundleName</key>
        <string>${config.modes.window.title}</string>
        <key>CFBundleDisplayName</key>
        <string>${config.modes.window.title}</string>
        <key>CFBundlePackageType</key>
        <string>APPL</string>
        <key>CFBundleVersion</key>
        <string>${config.version}</string>
        <key>CFBundleShortVersionString</key>
        <string>${config.version}</string>
        <key>NSHumanReadableCopyright</key>
        <string>Copyright © 2023 3Shain.</string>
        <key>LSMinimumSystemVersion</key>
        <string>10.15.0</string>
        <key>NSAppTransportSecurity</key>
        <dict>
            <key>NSAllowsArbitraryLoads</key>
            <true/>
        </dict>
    </dict>
    </plist>`
  );

  // Sign launcher and hosts-helper binaries (ad-hoc + hardened runtime),
  // then compute hashes and write build-manifest.json (contract section 4).
  const launcherBinaryPath = path.resolve(
    appBundlePath,
    "Contents",
    "MacOS",
    appname
  );
  const helperBinaryPath = path.resolve(
    appBundlePath,
    "Contents",
    "Resources",
    "sidecar",
    "yaaglm-hosts-helper",
    "yaaglm-hosts-helper"
  );
  for (const target of [launcherBinaryPath, helperBinaryPath]) {
    await execa("codesign", [
      "--force",
      "--options",
      "runtime",
      "--sign",
      "-",
      target,
    ]);
  }

  const sha256 = file =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const launcherSha256 = sha256(launcherBinaryPath);
  const helperSha256 = sha256(helperBinaryPath);

  await fs.writeJSON(
    path.resolve(
      appBundlePath,
      "Contents",
      "Resources",
      "build-manifest.json"
    ),
    {
      bundleId,
      version: config.version,
      appName: appDistributionName,
      launcherPath: `MacOS/${appname}`,
      launcherSha256,
      clientSha256: helperSha256,
      helperSha256,
    },
    { spaces: 2 }
  );
  console.log(`Built ${appBundlePath}`);
})();
