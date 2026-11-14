import { join } from "path-browserify";
import {
  fileOrDirExists,
  removeFileIfExists,
  resolve,
} from "@platform/neutralino";
import { generateRandomString } from "@runtime/binary";
import { exec } from "@runtime/command-runner";
import { mkdirp } from "@runtime/macos-filesystem";
import { getKeyOrDefault, setKey } from "@runtime/storage";
import { DownloadCancelledError } from "../download/control";
import { TaskFailedError } from "@tasks/task-program";

export const D3DMETAL_RUNTIME_ID = "wine-11.17-d3dmetal-gptk4.0b2-10";
const D3DMETAL_ARCHIVE_NAME = "wine-11.17-d3dmetal-gptk4.0b2-macos26.tar.xz";
export const D3DMETAL_RUNTIME_URL = `https://github.com/dbc-hbin/wine-yaagl-d3dmetal/releases/download/wine-11.17-gptk4.0b2-10/${D3DMETAL_ARCHIVE_NAME}`;
// Pins from the independently published Wine release.
export const D3DMETAL_ARCHIVE_SHA256 =
  "5084a2ca19071f9269193c9b6f003a82eeb96f823b1121382aa317ae2fb50fd4";
const D3DMETAL_ARCHIVE_SIZE = 239444460;
const D3DMETAL_HELPER_SHA256 =
  "a21eb0f6de40d5a7f1c23f989644b0966b99c637a5d8f0d26b7b26a5fbffe00e";
const REDISTRIBUTABLE_RELEASE =
  "https://github.com/dbc-hbin/d3dmetal-redistributable/releases/download/gptk-4.0b2";
const LICENSE_SHA256 =
  "5abb2d059be217663b00e8fd37e14411d374e11d17e3b744eebd49b8d17118c8";

const LICENSE_KEY = "d3dmetal_apple_license_sha256";
type RequestLicense = (loadLicense: () => Promise<string>) => Promise<boolean>;
let requestLicense: RequestLicense | undefined;

export function setD3DMetalLicensePrompt(prompt: RequestLicense) {
  requestLicense = prompt;
}

export async function requireD3DMetalLicense() {
  if ((await getKeyOrDefault(LICENSE_KEY, "")) === LICENSE_SHA256) return;
  const prompt = requestLicense;
  if (!prompt)
    throw new TaskFailedError("D3DMetal license review is unavailable");
  let verified = false;
  const accepted = await prompt(async () => {
    const text = await loadD3DMetalLicense();
    verified = true;
    return text;
  });
  if (!accepted) throw new DownloadCancelledError("D3DMetal license declined");
  if (!verified) throw new TaskFailedError("D3DMetal license was not verified");
  await setKey(LICENSE_KEY, LICENSE_SHA256);
}

export async function assertD3DMetalHostSupported() {
  const [arm64, version] = await Promise.all([
    exec(["/usr/sbin/sysctl", "-n", "hw.optional.arm64"]).catch(
      () => undefined
    ),
    exec(["/usr/bin/sw_vers", "-productVersion"]).catch(() => undefined),
  ]);
  if (
    arm64?.stdOut.trim() !== "1" ||
    !(Number(version?.stdOut.trim().split(".")[0]) >= 26)
  ) {
    throw new TaskFailedError(
      "D3DMetal Wine 11.17 requires Apple silicon and macOS 26 or later"
    );
  }
}

export async function isD3DMetalRuntimePrepared(wineRoot: string) {
  const output = join(wineRoot, "lib/external");
  return (
    (await fileOrDirExists(
      join(output, "D3DMetal.framework/Versions/A/D3DMetal")
    )) && (await fileOrDirExists(join(output, "prepared-d3dmetal.json")))
  );
}

async function sha256File(path: string): Promise<string> {
  const output = (
    await exec(["/usr/bin/shasum", "-a", "256", path])
  ).stdOut.trim();
  // shasum prefixes an escape marker when the filename contains a backslash.
  const hash = /^\\?([a-f0-9]{64})\s/i.exec(output);
  if (!hash) throw new Error(`Could not hash D3DMetal artifact: ${path}`);
  return hash[1].toLowerCase();
}

async function assertFileHash(path: string, expected: string) {
  if ((await sha256File(path)) !== expected) {
    throw new Error(`D3DMetal artifact SHA-256 mismatch: ${path}`);
  }
}

export async function verifyD3DMetalArchive(path: string) {
  const size = Number(
    (await exec(["/usr/bin/stat", "-f", "%z", path])).stdOut.trim()
  );
  if (size !== D3DMETAL_ARCHIVE_SIZE) {
    throw new Error("D3DMetal Wine archive size mismatch");
  }
  await assertFileHash(path, D3DMETAL_ARCHIVE_SHA256);
}

async function loadD3DMetalLicense(): Promise<string> {
  const directory = resolve("./d3dmetal-license");
  const license = join(directory, "License.rtf");
  await mkdirp(directory);
  if ((await sha256File(license).catch(() => undefined)) !== LICENSE_SHA256) {
    const downloaded = join(
      directory,
      `License.${generateRandomString(16)}.rtf`
    );
    try {
      await exec([
        "/usr/bin/curl",
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--max-time",
        "30",
        "--max-filesize",
        "18254",
        "--output",
        downloaded,
        `${REDISTRIBUTABLE_RELEASE}/License.rtf`,
      ]);
      await assertFileHash(downloaded, LICENSE_SHA256);
      await exec(["/bin/mv", "-f", downloaded, license]);
    } finally {
      await removeFileIfExists(downloaded);
    }
  }
  await assertFileHash(license, LICENSE_SHA256);
  const text = (
    await exec(["/usr/bin/textutil", "-convert", "txt", "-stdout", license])
  ).stdOut;
  if (!text.trim())
    throw new Error("Verified Apple license converted to empty text");
  return text;
}

export async function prepareD3DMetalWine(wineRoot: string) {
  const helper = join(
    wineRoot,
    "libexec/yaagl-d3dmetal/prepare-d3dmetal-runtime"
  );
  if ((await getKeyOrDefault(LICENSE_KEY, "")) !== LICENSE_SHA256) {
    throw new TaskFailedError("D3DMetal license acknowledgement is required");
  }
  await exec(["/bin/test", "-x", helper]);
  await assertFileHash(helper, D3DMETAL_HELPER_SHA256);
  await exec(["/usr/bin/codesign", "--verify", "--strict", helper]);
  const output = join(wineRoot, "lib/external");
  const prepared = join(wineRoot, ".prepared-d3dmetal");
  await exec([
    helper,
    "--output",
    prepared,
    "--cache",
    resolve("./d3dmetal-native-cache"),
    "--accept-apple-license",
  ]);
  await exec([
    "/usr/bin/codesign",
    "--verify",
    "--deep",
    "--strict",
    join(prepared, "D3DMetal.framework"),
  ]);
  await assertFileHash(join(prepared, "License.rtf"), LICENSE_SHA256);
  // The native helper validates its inputs, signatures and finished output
  // before publishing the prepared directory.
  for (const name of [
    "D3DMetal.framework",
    "prepared-d3dmetal.json",
    "License.rtf",
    "Acknowledgements.rtf",
    "SHA256SUMS",
  ]) {
    await exec(["/bin/mv", join(prepared, name), join(output, name)]);
  }
  await exec(["/bin/rmdir", prepared]);
}
