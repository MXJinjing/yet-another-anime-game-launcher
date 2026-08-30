# Release 版本构建指南

本文介绍如何在 macOS 上从源码构建 Yaaglm 的 release `.app`。构建脚本会生成带有 channel、版本号、架构信息以及 Hosts Helper 完整性校验信息的应用包。

## 1. 构建前准备

### 系统要求

- macOS。
- Xcode Command Line Tools：提供 `clang`、`codesign`、`shasum` 等工具。
- Node.js 和 pnpm。
- Python 3.11 或更高版本，以及 uv。
- 构建所需的磁盘空间。

检查基本工具：

```sh
node --version
pnpm --version
python3 --version
uv --version
clang --version
codesign --version
```

### 初始化仓库

在项目根目录执行：

```sh
pnpm install
./configure.sh
```

如果本地还没有 Sophon sidecar，先构建：

```sh
./build-sophon.sh
```

`build-app.js` 会从项目根目录的 `sidecar/` 复制运行时文件，因此以下内容应当已经存在：

```text
sidecar/
sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper
sidecar/yaaglm-hosts-helper/install.sh
sidecar/yaaglm-hosts-helper/uninstall.sh
```

Hosts Helper 二进制应当使用 `yaaglm-hosts-helper` 项目构建的 release 产物。构建前可以检查架构：

```sh
file sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper
```

## 2. Channel 与架构

通过 `YAAGL_CHANNEL_CLIENT` 选择 channel，通过 `YAAGL_BUILD_ARCH` 选择目标架构。

| Channel         | 典型应用名称        | Bundle ID 后缀 |
| --------------- | ------------------- | -------------- |
| `hk4ecn`        | `Yaaglm GI CN.app`  | 无后缀         |
| `hk4eos`        | `Yaaglm GI OS.app`  | `.hk4e.os`     |
| `hk4euniversal` | `Yaaglm Uni.app`    | `.uni`         |
| `mhycn`         | `Yaaglm CN.app`     | `.cn`          |
| `mhyos`         | `Yaaglm OS.app`     | `.os`          |
| `hkrpgcn`       | `Yaaglm HSR.app`    | `.hkrpg.cn`    |
| `hkrpgos`       | `Yaaglm HSR OS.app` | `.hkrpg.os`    |
| `napcn`         | `Yaaglm ZZZ.app`    | `.nap.cn`      |
| `napos`         | `Yaaglm ZZZ OS.app` | `.nap.os`      |

`hk4eos` 使用独立的 `com.3shain.yaaglm.hk4e.os` bundle ID 和 `Yaaglm GI OS.app` 应用名称，以避免与 `mhyos` 的 `com.3shain.yaaglm.os` / `Yaaglm OS.app` 冲突。已经安装旧版 `hk4eos` 的用户需要重新下载并安装新的 app；旧 bundle ID 的 Hosts Helper 注册项不会自动迁移。

支持的架构：

- `arm64`：Apple Silicon Mac。
- `x64`：Intel Mac。
- `universal`：同时包含 `arm64` 和 `x86_64` 的应用包，构建时间和体积更大。

## 3. 构建指定版本的单个 release App

### 重要：版本号需要同步设置

release 版本号来自两个地方：

1. `YAAGL_VERSION`：前端运行时使用的版本号；
2. `neutralino.config.json.version`：应用 Info.plist、build manifest 和注册表使用的版本号。

两者必须一致。`build-app.js` 会在结束时恢复自己的配置备份，但为了避免修改工作区中的 tracked 配置，建议使用下面的临时备份流程。

### 示例：构建 0.0.1 的 hk4e CN channel

在项目根目录执行：

```sh
set -euo pipefail

VERSION="0.0.1"
CHANNEL="hk4ecn"
ARCH="arm64"
CONFIG_BACKUP="/tmp/yaaglm-neutralino.config.json.$$"

cp neutralino.config.json "$CONFIG_BACKUP"
trap 'cp "$CONFIG_BACKUP" neutralino.config.json; rm -f "$CONFIG_BACKUP"' EXIT

RELEASE_VERSION="$VERSION" node -e '
  const fs = require("fs");
  const path = "neutralino.config.json";
  const config = JSON.parse(fs.readFileSync(path, "utf8"));
  config.version = process.env.RELEASE_VERSION;
  fs.writeFileSync(path, JSON.stringify(config));
'

YAAGL_CHANNEL_CLIENT="$CHANNEL" \
YAAGL_BUILD_ARCH="$ARCH" \
YAAGL_VERSION="$VERSION" \
node build-app.js
```

输出位置：

```text
release/arm64/Yaaglm GI CN.app
```

如果要构建 hk4e OS 或 Universal channel，只需修改变量：

```sh
CHANNEL="hk4eos"
ARCH="arm64"
```

或：

```sh
CHANNEL="hk4euniversal"
ARCH="universal"
```

### 使用独立临时配置文件的推荐写法

如果不希望在当前 shell 中写入配置，可以使用 Node.js 生成临时配置，再运行构建。无论采用哪种方式，构建结束后都应确认源码配置已经恢复。

```sh
grep -o '"version"[^,]*' neutralino.config.json | head -1
```

## 4. 构建全部 release channel

`build-all.sh` 会根据 Git tag 自动选择版本，并构建预设的全部 channel：

```sh
YAAGL_BUILD_ARCH=arm64 ./build-all.sh
```

也可以构建：

```sh
YAAGL_BUILD_ARCH=x64 ./build-all.sh
YAAGL_BUILD_ARCH=universal ./build-all.sh
```

默认列表包括：

```text
hk4ecn
mhyos
mhycn
hk4euniversal
hkrpgcn
hkrpgos
bh3glb
cbjq
cbjqcn
napos
napcn
```

`hk4eos` 不在默认批量列表中，需要单独执行 `build-app.js`。

如果需要构建指定版本而不是从 Git tag 自动取版本，建议使用上一节的单 channel 流程。不要直接修改 `build-all.sh` 中的版本计算逻辑来进行临时测试。

## 5. 构建流程会执行的操作

`build-app.js` 会依次完成：

1. 按 channel 修改临时 Neutralino 配置。
2. 执行 TypeScript 类型检查。
3. 执行 Vite 前端构建。
4. 执行 Neutralino 构建。
5. 创建 `release/<architecture>/<app>.app` 目录。
6. 复制 launcher、resources、sidecar 和 Hosts Helper。
7. 生成 `Info.plist` 和 `parameterized` 启动脚本。
8. 对 launcher 和 Hosts Helper 执行 ad-hoc hardened runtime 签名。
9. 计算 launcher/helper SHA-256。
10. 写入 `Contents/Resources/build-manifest.json`。

`parameterized` 启动脚本会从 `.app/Contents/Resources` 加载发布资源，并将当前工作目录设置为：

```text
~/Library/Application Support/<appName>/
```

该目录只保存用户数据、配置、日志和更新临时文件；`resources.neu`、`sidecar`、`build-manifest.json` 和图标保留在 `.app/Contents/Resources` 中。

同时设置：

```text
YAAGL_BUNDLE_PATH=<app bundle path>
```

Hosts Helper 的可信 bundle 检测依赖这个环境变量。测试时应从 `.app` 启动，不要直接执行 `Contents/MacOS/Yaaglm`。

## 6. 构建产物检查

假设产物位于：

```sh
APP="$(pwd)/release/arm64/Yaaglm GI CN.app"
```

检查应用和版本：

```sh
ls -ld "$APP"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist"
```

检查 build manifest：

```sh
cat "$APP/Contents/Resources/build-manifest.json"
```

manifest 至少应包含：

```json
{
  "bundleId": "com.3shain.yaaglm",
  "version": "0.0.1",
  "appName": "Yaaglm GI CN",
  "launcherPath": "MacOS/Yaaglm",
  "launcherSha256": "<64 hex characters>",
  "clientSha256": "<64 hex characters>",
  "helperSha256": "<64 hex characters>"
}
```

检查 helper 架构和哈希：

```sh
file "$APP/Contents/Resources/sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper"
shasum -a 256 \
  "$APP/Contents/Resources/sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper"
```

检查签名：

```sh
codesign --verify --verbose "$APP/Contents/MacOS/Yaaglm"
codesign --verify --verbose \
  "$APP/Contents/Resources/sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper"
```

## 7. 安装与 Hosts Helper 测试

### 启动测试 App

```sh
open "$APP"
```

不要直接从源码工作目录执行 launcher 二进制，否则不会经过 `parameterized`，也不会获得正确的 `YAAGL_BUNDLE_PATH`。

### 测试前卸载系统中的旧 helper

如果系统已经安装旧版本 Hosts Helper，建议先卸载，避免旧注册表、旧 hash 或旧 token 影响测试。

卸载操作需要 macOS 管理员授权：

```sh
osascript -e 'do shell script "/bin/sh <project>/sidecar/yaaglm-hosts-helper/uninstall.sh <bundle_id>" with administrator privileges'
```

例如 hk4e CN：

```sh
osascript -e 'do shell script "/bin/sh /path/to/yet-another-anime-game-launcher.modified/sidecar/yaaglm-hosts-helper/uninstall.sh com.3shain.yaaglm" with administrator privileges'
```

检查卸载结果：

```sh
ls -l \
  /Library/PrivilegedHelperTools/yaaglm-hosts-helper \
  /Library/LaunchDaemons/com.3shain.yaaglm.hosts-helper.plist \
  /var/run/yaaglm-hosts-helper.sock \
  /var/db/yaaglm-hosts-helper.registry

launchctl print system/com.3shain.yaaglm.hosts-helper
```

这些路径不存在或 `launchctl` 提示找不到 service，才表示旧 helper 已清理。

### 在启动器中安装新 helper

从全局设置中点击 Hosts Helper 的“安装”。启动器会使用管理员授权执行：

```text
install.sh --bundle <appBundlePath> --helper <bundle内helper二进制>
```

安装脚本会：

- 安装或更新 `/Library/PrivilegedHelperTools/yaaglm-hosts-helper`；
- 写入并启动 LaunchDaemon；
- 为当前 bundle 生成或复用 token；
- 写入 root 注册表；
- 将 token 保存到当前应用支持目录的 `tokens/` 下。

不要手动复制 token，也不要把 token 放入命令行或日志。

### 测试 token 丢失恢复

可以在确认应用已经安装过 helper 后，删除当前应用支持目录中的 token 文件，然后重新启动 `.app`：

```text
~/Library/Application Support/<appName>/tokens/<bundle_id>.token
```

启动器加载完成后应显示 token 恢复 Modal。点击“删除当前注册项”后：

1. 用户确认删除意图；
2. macOS 弹出管理员授权对话框；
3. 通过 `uninstall.sh <bundle_id>` 删除当前注册项；
4. token 已经不存在不应阻止卸载；
5. 其他 channel 的注册项不应被删除。

### 测试自动更新后的重新注册

1. 安装一个旧版本 release App 并完成 Hosts Helper 注册。
2. 从启动器内执行自动更新。
3. 更新前启动器会保存一次性重注册标记。
4. 更新完成并重启后，如果 token 仍存在，应尝试使用管理员授权重新注册。
5. 如果 token 已丢失，应显示恢复 Modal，不应自动删除注册项，也不应直接自动重注册。

## 8. 常见问题

### 启动器显示开发版本，Hosts Helper 不可用

`YAAGL_VERSION` 未设置时，版本常量默认为 `development`。开发版本会主动禁用 Hosts Helper。

构建 release 时必须设置非 `development` 的版本号，例如：

```sh
YAAGL_VERSION=0.0.1
```

同时确认 `neutralino.config.json.version` 也设置为相同版本。

### manifest 版本不是目标版本

说明只设置了 `YAAGL_VERSION`，没有同步修改 `neutralino.config.json.version`。重新使用本指南的版本同步流程构建。

### helper 已运行但启动器提示未注册

检查：

- 是否从 `.app` 启动，而不是直接运行二进制；
- `build-manifest.json` 的 bundle ID 和 version 是否正确；
- app 是否被移动或修改过；
- 当前 token 文件是否存在；
- 是否残留旧版本注册表。

可以先在全局设置中卸载当前 bundle 注册项，再重新点击安装。

### 构建后 `neutralino.config.json` 被修改

`build-app.js` 会尝试恢复配置。如果构建过程中被强制中断，手动恢复：

```sh
git checkout -- neutralino.config.json
```

如果该文件包含本地定制，请从构建前备份恢复，不要盲目覆盖个人修改。

## 9. 发布前检查清单

- [ ] `YAAGL_VERSION` 是正式版本号，不是 `development`。
- [ ] `neutralino.config.json.version` 与 `YAAGL_VERSION` 一致。
- [ ] 目标 channel 正确。
- [ ] 目标架构正确。
- [ ] Sophon sidecar 已更新。
- [ ] Hosts Helper 二进制来自正确的 release 构建。
- [ ] `Info.plist` 的 bundle ID 和版本正确。
- [ ] `build-manifest.json` 存在且字段完整。
- [ ] launcher 和 helper 的 codesign 校验通过。
- [ ] launcher 从 `.app` 启动测试成功。
- [ ] Hosts Helper 安装、注册、hosts 操作和卸载流程测试成功。
- [ ] 测试 token 丢失恢复流程成功。
- [ ] 没有把 token、账号或本地敏感路径提交到仓库或发布包。
