import { describe, expect, it } from "vitest";
import { startupNoticeMessage } from "@src/components/startup-notice-messages";

describe("startup notice messages", () => {
  it("explains the download service outage and that installed games still work", () => {
    expect(
      startupNoticeMessage("download-service-unavailable", "zh_CN")
    ).toContain("已安装的游戏仍可启动");
    expect(
      startupNoticeMessage("download-service-unavailable", "en")
    ).toContain("installed games can still be launched");
  });

  it("explains the GitHub prefix fallback", () => {
    expect(startupNoticeMessage("github-prefix-disabled", "zh")).toContain(
      "api.github.com"
    );
    expect(startupNoticeMessage("github-prefix-disabled", "en")).toContain(
      "api.github.com"
    );
  });
});
