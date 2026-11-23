# 国服米游社本地原型

启动器中的扫码绑定、角色查询和一键签到通过本地 macOS 辅助程序验证。账号仅支持本次运行期间的扫码登录。开发模式下启用原型，发布打包当前不包含辅助程序。

## 启动

先按仓库的开发说明完成启动器初始化。以下命令编译 Swift 辅助程序，并为国服合并包和三款独立包准备同一个原型。开发目录内的数据按安装目录隔离。

```sh
miyoushe_dev_bin_dir="$(mktemp -d)"
swiftc -D MIYOUSHE_ACCOUNT_BRIDGE -parse-as-library native/miyoushe-prototype.swift native/miyoushe-history.swift -o "$miyoushe_dev_bin_dir/miyoushe-prototype"
swiftc -parse-as-library native/miyoushe-history.swift -o "$miyoushe_dev_bin_dir/miyoushe-history"
for miyoushe_dev_dir in dev/yaaglmwdcn dev/yaaglmwd dev/hkrpgcn dev/napcn; do
  mkdir -p "$miyoushe_dev_dir/sidecar"
  cp "$miyoushe_dev_bin_dir"/miyoushe-* "$miyoushe_dev_dir/sidecar/"
done
YAAGL_MIYOUSHE_PROTOTYPE=1 pnpm run start-mhycn
```

独立包分别把最后一行中的脚本改为 `start`、`start-hkrpgcn` 或 `start-napcn`。从侧栏头像打开「米游社账号」，点击「仅本次登录」获取二维码，再用米游社 App 扫码并在手机上确认。已登录时，可在同一菜单继续登录其他账号、切换当前账号或移除本次会话中的账号。

扫码票据、Cookie 和 App 会话令牌留在本机辅助程序内存中。退出启动器或会话过期后，下次使用需重新扫码。当前账号由签到与抽卡工具共享，每个账号可在本次运行期间按游戏记住所选角色和已确认的签到日期。旧保险库和钥匙串条目保留原状。

启动游戏旁的签到菜单只展示今日奖励。点击「查看月历」可在独立弹窗中查看整月。奖励目录只按游戏请求公开数据，领取进度来自当前角色服务端返回的累计签到天数。北京时间跨月后重新加载当月目录。

## 抽卡分析

启动器内置的简中目录由 [genshin-db-dist 固定提交](https://github.com/theBowja/genshin-db-dist/tree/db37a96e1dac3f56d0e6f015c4ff4f87c25577cd) 中的角色、武器压缩 JSON 生成。快照保留物品 ID、名字、稀有度和图标引用。国服原神渠道启动时会后台更新公开目录，并下载缺少的头像。报告优先读取本地头像缓存。

国服角色和武器活动池的历史 UP 数据来自 [Snap.Metadata 固定快照](https://github.com/SnapHutaoRemasteringProject/Snap.Metadata/blob/fb3e2692579495c6b181403da01fde1e5b8f9193/Genshin/CHS/GachaEvent.json)，随启动器分发。只保留池号、北京时间范围和最高稀有度 UP 物品 ID。版本维护日按当天 11:00 后的记录分类。超出覆盖范围、集录定轨目标不可知或原始池号已丢失的条目，可能无法判定 UP 和保底状态。

`hk4e_cn` 支持同步祈愿记录。打开报告时显示本地档案，点击「刷新」后才读取官方接口。读取和保存期间，按钮显示「刷新中」并旋转刷新图标。操作结束后以 HopeUI 通知显示结果。最近更新时间记录当前 UID 最近一次成功保存导入或同步结果的本机时间，记录覆盖日期单独显示。

报告刷新按钮旁的「设置」打开独立弹窗，提供 UIGF 格式说明和文件导入。当前游戏的本地档案按 UID 分页显示，每页五条。每行可单独导出或确认删除，多个 UID 可以一起导出。

「刷新」下拉菜单提供两种独立操作。

- 「从游戏读取」检查已配置的安装目录与 Wine 前缀，尝试使用游戏 WebView 缓存的祈愿链接补读官方记录。链接缺失、过期或连接失败时，可读取已有的有效缓存记录。需要生成新链接时，在游戏内打开祈愿历史。
- 「登录米游社同步」打开同一个临时扫码面板。已登录时可复用本次会话，选择官服角色后直接同步。授权过期时重新扫码。

两条路径都在本机辅助程序内使用临时祈愿授权，遇到人工验证、限流或记录 UID 不一致时停止请求。结果按游戏返回的 UID 保存，按抽卡记录 ID 去重。`hkrpg_cn` 和 `nap_cn` 支持 UIGF 导入和导出。真实扫码确认后的在线读取仍需用自有测试账号联调。[UIGF 授权参考](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/token.html)

## 验证记录

- 原神、星穹铁道和绝区零的渠道映射、抽卡导入导出和签到流程均有离线测试。扫码接口已返回可显示的二维码。
- 真实账号仍需先在原神验证绑定、官服角色识别、首次签到、今日已签、登录过期和解绑，再用同一账号验证星穹铁道和绝区零。服务端要求人工验证时，启动器停止提交并显示状态。
- 三款游戏实测通过，并确认桌面端的公开发布条件后，才将绑定和一键签到交付到发布包。

协议行为参考 [MYS-Daily](https://github.com/MightyOwls/MYS-Daily)、[miyoushe-tool](https://github.com/XYRQ-Dev/miyoushe-tool) 及 UIGF 的[游戏账号](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/game_account_info.html)、[用户信息](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/info.html)和[令牌文档](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/token.html)。抽卡文件格式参考 [UIGF v4.2](https://uigf.org/zh/standards/uigf.html)。
