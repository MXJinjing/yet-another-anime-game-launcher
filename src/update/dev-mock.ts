/**
 * Fixed data used by development builds to exercise the launcher update UI and
 * the release-log modal without touching the network or the real update
 * pipeline. Only referenced when `CURRENT_YAAGL_VERSION === "development"`.
 */

export const DEV_UPDATE_INFO = {
  downloadUrl: "development://mock-update",
  sidecarDownloadUrl: undefined,
  version: "9.9.9-dev",
  description: `## 开发版 UI 测试更新

这是一份**固定**的更新说明，仅用于 UI 测试，**不会联网**获取。

### 新功能
- 更新弹窗改用 markdown 渲染更新日志
- 新增“当前版本更新日志”查看入口
- 标题栏统一返回按钮

### 修复
1. 修复开发版 UI 测试流程
2. 修复弹窗样式与滚动

> 提示：点击“更新启动器”只会模拟进度，不会真实下载。

\`\`\`sh
pnpm dev
\`\`\`

| 项目 | 值 |
| --- | --- |
| 版本 | 9.9.9-dev |
| 渠道 | hk4ecn |`,
} as const;

export const DEV_RELEASE_LOG = `# Yaaglm 9.9.9-dev（开发版 UI 测试）

这是一份**固定的**当前版本更新日志，仅用于 UI 测试，不会联网获取。

## 界面改动
- 更新弹窗改用 markdown 渲染更新日志
- 新增“查看更新日志”弹窗
- About 页新增返回按钮，返回按钮统一到标题栏左侧

## 待办
1. 上线前替换为真实 release 数据
2. 回归测试各渠道

> 注意：本页内容为模拟数据。
`;
