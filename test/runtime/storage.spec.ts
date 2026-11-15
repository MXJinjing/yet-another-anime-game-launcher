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

import { createStorage, globalStorage } from "@runtime/storage";

beforeEach(() => {
  readFile.mockClear();
  removeFile.mockClear();
  writeFile.mockClear();
});

describe("instance storage", () => {
  it("keeps game-owned keys in their immutable namespace", async () => {
    const hk4e = createStorage("test-a");
    const hsr = createStorage("test-b");

    await hk4e.setKey("game_install_dir", "/games/a");
    await hsr.setKey("game_install_dir", "/games/b");

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

  it("migrates legacy DXMT preferences while keeping new settings in each game scope", async () => {
    const globalGame = createStorage("hpgenshin");
    const chinaGame = createStorage("hpcngenshin");
    const otherGame = createStorage("test-a");

    await globalGame.getKey("config_preferred_max_fps");
    expect(readFile).toHaveBeenCalledWith(
      "/tmp/Library/Application Support/Yaaglm OS/.storage/config_preferred_max_fps.neustorage"
    );

    readFile.mockRejectedValueOnce(new Error("missing overseas preference"));
    await expect(
      globalGame.getKey("config_dxmt_refresh_rate")
    ).rejects.toThrow();
    expect(readFile).not.toHaveBeenCalledWith(
      "/tmp/Library/Application Support/Yaaglm/.storage/config_dxmt_refresh_rate.neustorage"
    );

    await globalGame.setKey("config_dxmt_refresh_rate", "global");
    await chinaGame.setKey("config_dxmt_refresh_rate", "china");
    await otherGame.setKey("config_dxmt_refresh_rate", "other");
    expect(writeFile).toHaveBeenNthCalledWith(
      1,
      "/tmp/Library/Application Support/Yaaglm OS/.storage/config_dxmt_refresh_rate.neustorage",
      "global"
    );
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      "/tmp/Library/Application Support/Yaaglm/.storage/config_dxmt_refresh_rate.neustorage",
      "china"
    );
    expect(writeFile).toHaveBeenNthCalledWith(
      3,
      ".storage/test-a_config_dxmt_refresh_rate.neustorage",
      "other"
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
