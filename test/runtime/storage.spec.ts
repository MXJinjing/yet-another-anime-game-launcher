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

  it("leaves launcher-wide keys in the default storage scope", async () => {
    await globalStorage.setKey("hyp_last_view", "hk4e");
    expect(writeFile).toHaveBeenCalledWith(
      ".storage/hyp_last_view.neustorage",
      "hk4e"
    );
  });
});
