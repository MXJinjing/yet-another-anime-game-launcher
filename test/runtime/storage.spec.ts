import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn(async () => "");
const removeFile = vi.fn(async () => undefined);
const writeFile = vi.fn(async () => undefined);

vi.mock("@platform/neutralino/filesystem", () => ({
  readFile,
  removeFile,
  writeFile,
}));

vi.mock("@runtime/command-runner", () => ({
  exec: vi.fn(async () => ({ stdOut: "", stdErr: "" })),
}));

vi.mock("@platform/neutralino/system", () => ({
  env: vi.fn(async () => "/tmp"),
}));

import { exec } from "@runtime/command-runner";
import { createStorage, globalStorage } from "@runtime/storage";

beforeEach(() => {
  readFile.mockClear();
  removeFile.mockClear();
  writeFile.mockClear();
  vi.mocked(exec).mockClear();
  vi.stubGlobal("window", {
    NL_CWD: "/launcher",
    NL_PATH: "dev/yaaglmwd",
  });
});

describe("instance storage", () => {
  it("keeps game-owned keys in their immutable namespace", async () => {
    const hk4e = createStorage("test-a");
    const hsr = createStorage("test-b");

    await hk4e.setKey("game_install_dir", "/games/a");
    await hsr.setKey("game_install_dir", "/games/b");

    expect(vi.mocked(exec)).toHaveBeenCalledWith([
      "mkdir",
      "-p",
      "/launcher/dev/yaaglmwd/.storage",
    ]);
    expect(writeFile).toHaveBeenNthCalledWith(
      1,
      ".storage/test-a_game_install_dir.neustorage",
      "/games/a"
    );
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      ".storage/test-b_game_install_dir.neustorage",
      "/games/b"
    );
  });

  it("stores the window-exit preference separately for each game", async () => {
    await createStorage("test-a").setKey("config_exit_on_window_close", "true");
    await createStorage("test-b").setKey(
      "config_exit_on_window_close",
      "false"
    );

    expect(writeFile).toHaveBeenNthCalledWith(
      1,
      ".storage/test-a_config_exit_on_window_close.neustorage",
      "true"
    );
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      ".storage/test-b_config_exit_on_window_close.neustorage",
      "false"
    );
  });

  it("reads game-owned keys from the game scope only", async () => {
    const chinaGame = createStorage("hpcngenshin");

    readFile.mockRejectedValueOnce(new Error("missing game preference"));
    await expect(chinaGame.getKey("config_preferred_max_fps")).rejects.toThrow(
      "missing game preference"
    );
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(
      ".storage/hpcngenshin_config_preferred_max_fps.neustorage"
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("writes game-owned keys only to their own scope", async () => {
    await createStorage("hpcnzzz").setKey("game_install_dir", "/games/zzz");

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(
      ".storage/hpcnzzz_game_install_dir.neustorage",
      "/games/zzz"
    );
  });

  it("keeps the ZZZ MetalFX switch separate for each game", async () => {
    await createStorage("all-zzz-cn").setKey(
      "config_nap_metalfx_enable",
      "true"
    );
    await createStorage("all-zzz-os").setKey(
      "config_nap_metalfx_enable",
      "false"
    );

    expect(writeFile).toHaveBeenNthCalledWith(
      1,
      ".storage/all-zzz-cn_config_nap_metalfx_enable.neustorage",
      "true"
    );
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      ".storage/all-zzz-os_config_nap_metalfx_enable.neustorage",
      "false"
    );
  });

  it("keeps predownload preferences separate across game regions", async () => {
    const key = "sophon_predownload_directory";
    const overseas = createStorage("hphsr");
    const china = createStorage("hpcnhsr");

    await overseas.setKey(key, "/Volumes/OS");
    await china.setKey(key, "");
    expect(writeFile).toHaveBeenNthCalledWith(
      1,
      ".storage/hphsr_sophon_predownload_directory.neustorage",
      "/Volumes/OS"
    );
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      ".storage/hpcnhsr_sophon_predownload_directory.neustorage",
      ""
    );

    readFile.mockRejectedValueOnce(new Error("missing overseas directory"));
    await expect(overseas.getKey(key)).rejects.toThrow(
      "missing overseas directory"
    );
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(
      ".storage/hphsr_sophon_predownload_directory.neustorage"
    );
  });

  it("leaves launcher-wide keys in the default storage scope", async () => {
    await globalStorage.setKey("hyp_last_view", "hk4e");
    expect(writeFile).toHaveBeenCalledWith(
      ".storage/hyp_last_view.neustorage",
      "hk4e"
    );
  });
});
