import { describe, expect, it } from "vitest";
import { GameAlreadyRunningError } from "@src/clients/launch-errors";
import {
  RuntimeReplacementConfigInvalidError,
  RuntimeReplacementFileMissingError,
  RuntimeReplacementImpossibleError,
  RuntimeReplacementVerificationError,
} from "@src/clients/mhy/patch";
import { resolveLaunchFailure } from "@src/launcher/controller/launch-failure-policy";

describe("launch failure policy", () => {
  it("asks to force-stop a game that is already running", () => {
    const error = new GameAlreadyRunningError("/game/TargetGame.exe");
    expect(resolveLaunchFailure(error, "LAUNCH")).toEqual({
      kind: "already-running",
      executablePath: "/game/TargetGame.exe",
    });
  });

  it("keeps the missing replacement file modal", () => {
    expect(
      resolveLaunchFailure(
        new RuntimeReplacementFileMissingError("替换文件不存在"),
        "LAUNCH"
      )
    ).toEqual({
      kind: "replacement-error",
      details: "替换文件不存在",
    });
  });

  it.each([
    new RuntimeReplacementConfigInvalidError("缺少替换文件"),
    new RuntimeReplacementVerificationError("临时副本校验失败"),
  ])("asks before skipping a recoverable replacement problem", error => {
    expect(resolveLaunchFailure(error, "LAUNCH")).toEqual({
      kind: "replacement-prompt",
      details: error.message,
    });
  });

  it("skips a replacement that can never be applied", () => {
    expect(
      resolveLaunchFailure(
        new RuntimeReplacementImpossibleError("目标路径无效"),
        "LAUNCH"
      )
    ).toEqual({
      kind: "replacement-skip",
      details: "目标路径无效",
    });
  });

  it("leaves other failures to the generic notifier", () => {
    expect(resolveLaunchFailure(new Error("boom"), "LAUNCH")).toEqual({
      kind: "default",
    });
    expect(
      resolveLaunchFailure(new GameAlreadyRunningError("/game/x"), "UPDATE")
    ).toEqual({ kind: "default" });
  });
});
