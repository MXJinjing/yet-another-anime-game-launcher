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

启动器内置的简中目录由 [genshin-db-dist 固定提交](https://github.com/theBowja/genshin-db-dist/tree/db37a96e1dac3f56d0e6f015c4ff4f87c25577cd) 中的角色、武器压缩 JSON 生成。快照保留物品 ID、名字、稀有度和图标引用。运行时从上游检查并更新公开目录。祈愿规则随启动器交付，当前只有已核对的期次可分类历史 UP。

原型的「从游戏读取」支持原神。先在游戏内打开祈愿历史，再在启动器中点击读取。启动器可导入配置目录中已有的静态结果，缓存只有查询链接时由本地辅助程序读取官方记录。米游社网页扫码凭证和游戏抽卡授权是两条链路，绑定后的自动读取目前仅基于所选角色匹配的静态缓存。星穹铁道和绝区零可使用 UIGF 导入。

## 验证记录

- 原神、星穹铁道和绝区零的渠道映射、抽卡导入导出和签到流程均有离线测试。扫码接口已返回可显示的二维码。
- 真实账号仍需先在原神验证绑定、官服角色识别、首次签到、今日已签、登录过期和解绑，再用同一账号验证星穹铁道和绝区零。真实提交遇到人机验证时，使用面板中的官方签到入口。
- 三款游戏实测通过，并确认桌面端的公开发布条件后，才将绑定和一键签到交付到发布包。

协议行为参考 [MYS-Daily](https://github.com/MightyOwls/MYS-Daily)、[miyoushe-tool](https://github.com/XYRQ-Dev/miyoushe-tool) 及 UIGF 的[游戏账号](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/game_account_info.html)、[用户信息](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/info.html)和[令牌文档](https://uigf.org/zh/mihoyo-api-collection/hoyolab/user/token.html)。抽卡文件格式参考 [UIGF v4.2](https://uigf.org/zh/standards/uigf.html)。
