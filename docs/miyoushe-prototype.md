# 国服米游社本地原型

启动器中的扫码绑定、角色查询和一键签到通过本地 macOS 辅助程序验证。辅助程序将账号凭证保存在当前安装对应的钥匙串条目里。开发模式下启用原型，发布打包当前不包含辅助程序。

## 启动

先按仓库的开发说明完成启动器初始化。以下命令编译不需要额外依赖的 Swift 辅助程序，并为国服合并包和三款独立包准备同一个原型。开发目录内的数据和钥匙串条目按安装目录隔离。

```sh
miyoushe_dev_bin_dir="$(mktemp -d)"
swiftc -parse-as-library native/miyoushe-prototype.swift -o "$miyoushe_dev_bin_dir/miyoushe-prototype"
swiftc -parse-as-library native/miyoushe-history.swift -o "$miyoushe_dev_bin_dir/miyoushe-history"
for miyoushe_dev_dir in dev/yaaglmwdcn dev/yaaglmwd dev/hkrpgcn dev/napcn; do
  mkdir -p "$miyoushe_dev_dir/sidecar"
  cp "$miyoushe_dev_bin_dir"/miyoushe-* "$miyoushe_dev_dir/sidecar/"
done
YAAGL_MIYOUSHE_PROTOTYPE=1 pnpm run start-mhycn
```

独立包分别把最后一行中的脚本改为 `start`、`start-hkrpgcn` 或 `start-napcn`。用米游社 App 扫码，并在手机上确认登录。

## 抽卡分析

启动器内置的简中目录由 [genshin-db-dist 固定提交](https://github.com/theBowja/genshin-db-dist/tree/db37a96e1dac3f56d0e6f015c4ff4f87c25577cd) 中的角色、武器压缩 JSON 生成。快照保留物品 ID、名字、稀有度和图标引用。运行时从上游检查并更新公开目录。

国服角色和武器活动池的历史 UP 数据来自 [Snap.Metadata 固定快照](https://github.com/SnapHutaoRemasteringProject/Snap.Metadata/blob/fb3e2692579495c6b181403da01fde1e5b8f9193/Genshin/CHS/GachaEvent.json)，随启动器分发。只保留池号、北京时间范围和最高稀有度 UP 物品 ID。版本维护日按当天 11:00 后的记录分类。超出覆盖范围、集录定轨目标不可知或原始池号已丢失的条目，可能无法判定 UP 和保底状态。

原神官服支持同步祈愿记录。先用准备同步的角色在游戏内打开祈愿历史，让游戏生成临时授权。绑定米游社并选择角色后，启动器在选择角色或打开报告时检查更新，同一 UID 的自动请求至少间隔五分钟。也可以点击「同步记录」，重新读取官方接口提供的历史区间。授权过期时重新打开游戏内的祈愿历史。

未绑定时可用「从游戏读取」导入已缓存的记录；只有授权链接时，本地辅助程序通过该链接连接官方祈愿记录服务。米游社扫码绑定用于识别角色，在线祈愿同步使用游戏生成的临时授权。结果按 UID 保存到本机，按抽卡记录 ID 去重。星穹铁道和绝区零支持 UIGF 导入和导出。

## 验证记录

- 原神、星穹铁道和绝区零的渠道映射、抽卡导入导出和签到流程均有离线测试。扫码接口已返回可显示的二维码。
- 真实账号仍需先在原神验证绑定、官服角色识别、首次签到、今日已签、登录过期和解绑，再用同一账号验证星穹铁道和绝区零。真实提交遇到人机验证时，使用面板中的官方签到入口。
- 三款游戏实测通过，并确认桌面端的公开发布条件后，才将绑定和一键签到交付到发布包。

协议行为参考 [MYS-Daily](https://github.com/MightyOwls/MYS-Daily)、[miyoushe-tool](https://github.com/XYRQ-Dev/miyoushe-tool) 及 UIGF 的[游戏账号](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/game_account_info.html)、[用户信息](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/info.html)和[令牌文档](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/token.html)。抽卡文件格式参考 [UIGF v4.2](https://uigf.org/zh/standards/uigf.html)。
