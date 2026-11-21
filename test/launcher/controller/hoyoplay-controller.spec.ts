import { describe, expect, it } from "vitest";
import { gameDownloadTaskMetadata } from "@src/launcher/controller/hyp-controller";
import { inferUnityLogLevel } from "@src/logging/runtime-log";
import type { HypGame } from "@src/launcher/controller/launcher-types";

function game(overrides: Partial<HypGame> = {}): HypGame {
  return {
    id: "hk4ecn",
    clientId: "hk4ecn",
    title: "原神 CN",
    fallbackIcon: "",
    serverLabel: "国服",
    config: {},
    ConfigurationUI: () => null,
    client: {
      predownloadVersion: () => "7.2.0",
      latestVersion: () => "7.1.0",
      gameVersion: () => "7.0.0",
    },
    ...overrides,
  } as unknown as HypGame;
}

const locale = {
  get: (key: string) =>
    ({
      SERVER_LABEL_CN: "国服",
      SERVER_LABEL_GLOBAL: "国际服",
      DOWNLOAD_TASK_ACTION_INSTALL: "安装",
      DOWNLOAD_TASK_ACTION_UPDATE: "更新",
      DOWNLOAD_TASK_ACTION_PREDOWNLOAD: "预下载",
      DOWNLOAD_TASK_ACTION_INTEGRITY: "检测游戏完整性",
      DOWNLOAD_TASK_IN_PROGRESS: "正在{0}",
      DOWNLOAD_TASK_IN_PROGRESS_VERSION: "正在{0} {1}",
    }[key] ?? key),
  format: (key: string, args: string[]) =>
    key === "DOWNLOAD_TASK_IN_PROGRESS_VERSION"
      ? `正在${args[0]} ${args[1]}`
      : key === "DOWNLOAD_TASK_IN_PROGRESS"
      ? `正在${args[0]}`
      : key,
} as never;

describe("hyp launcher controller", () => {
  it("formats task titles as name, region, version, and action", () => {
    expect(gameDownloadTaskMetadata(game(), locale, "install")).toEqual({
      title: "原神 CN 安装 7.1.0",
      progressTitle: "正在安装 7.1.0",
      key: undefined,
    });
    expect(gameDownloadTaskMetadata(game(), locale, "update")).toEqual({
      title: "原神 CN 更新 7.1.0",
      progressTitle: "正在更新 7.1.0",
      key: undefined,
    });
    expect(gameDownloadTaskMetadata(game(), locale, "predownload")).toEqual({
      title: "原神 CN 预下载 7.2.0",
      progressTitle: "正在预下载 7.2.0",
      key: undefined,
    });
    expect(
      gameDownloadTaskMetadata(
        game({
          id: "napos",
          clientId: "napos",
          title: "绝区零",
          serverLabel: "国际服",
        }),
        locale,
        "integrity"
      )
    ).toEqual({
      title: "绝区零 OS 检测游戏完整性 7.0.0",
      progressTitle: "正在检测游戏完整性 7.0.0",
      key: undefined,
    });
  });

  it("classifies Unity log severity without a view dependency", () => {
    expect(inferUnityLogLevel("fatal error opening archive")).toBe("ERROR");
    expect(inferUnityLogLevel("warning: missing shader")).toBe("WARNING");
    expect(inferUnityLogLevel("scene loaded")).toBe("INFO");
  });
});
