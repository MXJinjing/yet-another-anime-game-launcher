/**
 * Fixed data used by development builds to exercise the launcher update UI and
 * the release-log modal without touching the network or the real update
 * pipeline. Only referenced when `CURRENT_YAAGL_VERSION === "development"`.
 */

export const DEV_UPDATE_INFO = {
  downloadUrl: "development://mock-update",
  sidecarDownloadUrl: undefined,
  version: "9.9.9-dev",
  description: `## 新功能
- 关于页面新增「更新日志」，可查看当前版本说明
- 更新弹窗排版更清晰，下载时显示实时速度与进度

## 改进
- 更新机制重构：整体替换应用，更新更完整可靠
- 更新后 hosts 助手自动升级，无需手动重新授权
- 启动与重启更稳定，修复下载服务偶发启动失败
- 安装 Wine 后主按钮显示「继续安装」，引导更明确
- 更新下载可取消，关闭启动器时会安全中止更新

## 修复
- 自动修复旧版本热更新安装不完整的问题
- 修复重启后启动画面残留、界面透出旧内容的问题
- 修复国服游戏图标显示异常
- 修复更新后启动器未正确重启的问题

> 提示：点击“更新启动器”只会模拟进度，不会真实下载。`,
} as const;

export const DEV_RELEASE_LOG = `# Yaaglm 9.9.9-dev（开发版 UI 测试）

这是一份**固定的**当前版本更新日志，仅用于 UI 测试，不会联网获取。

## 新功能
- 关于页面新增「更新日志」入口
- 更新弹窗排版更清晰，下载时显示实时速度与进度

## 改进
- 更新机制重构：整体替换应用，避免新旧文件混杂
- 更新后 hosts 助手自动升级，无需手动重新授权
- 启动与重启更稳定，修复下载服务偶发启动失败
- 安装 Wine 后主按钮显示「继续安装」，引导更明确
- 启动文案优化：显示「正在加载游戏渠道配置」，多渠道显示 (1/3)

## 修复
- 自动修复旧版本热更新安装不完整的问题
- 修复重启后启动画面残留、界面透出旧内容的问题
- 修复国服游戏图标显示异常
- 修复更新后启动器未正确重启的问题

> 注意：本页内容为模拟数据。`;
