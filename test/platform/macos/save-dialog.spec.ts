import { afterEach, expect, it, vi } from "vitest";
import { chooseSavePath } from "@platform/macos/save-dialog";

function mockDialog(stdOut: string, exitCode = 0) {
  const execCommand = vi.fn(async (_command: string) => ({ exitCode, stdOut }));
  vi.stubGlobal("Neutralino", { os: { execCommand } });
  return execCommand;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("passes the suggested filename separately and preserves the chosen path", async () => {
  const path = "/Users/test/抽卡记录/hk4e-100000001-uigf-v4.2.json";
  const execCommand = mockDialog(path + "\n");
  await expect(
    chooseSavePath("导出抽卡记录", "hk4e-100000001-uigf-v4.2.json")
  ).resolves.toBe(path);
  const [[command]] = execCommand.mock.calls;
  expect(command).toContain("default\\ name\\ \\(item\\ 2\\ of\\ argv\\)");
  expect(command).toMatch(/ 导出抽卡记录 hk4e-100000001-uigf-v4\.2\.json$/);
});

it("distinguishes a cancelled dialog from a native error", async () => {
  mockDialog("\n");
  await expect(chooseSavePath("Export", "uigf.json")).resolves.toBe("");

  mockDialog("", 1);
  await expect(chooseSavePath("Export", "uigf.json")).rejects.toThrow();
});
