import type { StartupNoticeId } from "../runtime/startup-notices";

const messages: Record<StartupNoticeId, { zh: string; en: string }> = {
  "download-service-unavailable": {
    zh: "下载服务不可用，安装、更新和预下载暂时无法使用；已安装的游戏仍可启动。请重启启动器后重试。",
    en: "The download service is unavailable. Install, update and predownload are temporarily disabled; installed games can still be launched. Please restart the launcher and try again.",
  },
  "github-prefix-disabled": {
    zh: "已停用启动器加速前缀，已回退到 api.github.com。",
    en: "A launcher acceleration prefix was disabled; the launcher fell back to api.github.com.",
  },
};

/** Localized copy for a startup notice, using the launcher's inline bilingual
 * pattern instead of growing the locale key set. */
export function startupNoticeMessage(id: StartupNoticeId, language: string) {
  const message = messages[id];
  return language.startsWith("zh") ? message.zh : message.en;
}
