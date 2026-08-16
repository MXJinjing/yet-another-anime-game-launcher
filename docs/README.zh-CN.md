# Yaaglm（Yet Another Anime Game Launcher Modified）

[English version](../README.md)

> **⚠️ 个人 Fork 说明**
>
> **本仓库是上游 Yaagl 的个人构建 fork，公开名称为 Yaaglm，用于个人测试、定制和维护，不代表上游官方版本。**

## Current Supported Game Version

### GI: 5.3.0+ OS/CN \*\*

### HSR: 4.3.0 OS/CN

### ZZZ: 3.0.0 OS/CN

#### **注意：** 从 0.3.12 版本开始，使用 DXMT 0.74 时需要升级到 macOS Sequoia 或更高版本。Sonoma 缺少改进图形转换所需的部分系统能力。

<!-- ## Policy

请不要在公开渠道传播本仓库链接。如需分享，请使用项目名称和 GitHub 作为检索关键词。

不要在公开社区发布完整的使用教程；如确有必要，请先取得项目维护者许可。

不要在代码提交、Issue、Pull Request 或讨论中提及真实产品或公司名称，请使用 **The Anime Game** 或 **The Anime Company** 等中性称呼。

分享日志、截图或配置时，请先移除账号、路径、令牌和其他隐私信息。 -->

<!-- ### Hall of Shame

本节用于记录违反 Yaaglm 协作规范的行为。目前不列出任何个人或组织。 -->

## Is it safe?

请自行评估并承担使用风险。建议先使用独立的测试环境或新建的非关键账户，不要在没有备份的情况下修改原始游戏文件、Wine 前缀或系统配置。

Yaaglm 是一个面向 macOS 的桌面启动器，用于管理不同区域和发行渠道的 Windows 游戏程序。项目提供统一的界面、下载与更新流程、游戏库管理、运行时配置以及基于 Wine 的启动支持。

项目使用 `YAAGL_CHANNEL_CLIENT` 在构建阶段选择目标 channel。不同 channel 可以对应不同区域、发行渠道或多游戏整合入口；每个 channel 都会使用相应的客户端配置、资源地址和运行时设置。

> 本项目面向熟悉 macOS、终端和 Windows 兼容层的用户。使用前请确认自己了解相关程序的系统要求、文件存储位置和数据备份方式。

## Features

- 基于 Neutralinojs 的轻量 macOS 桌面应用。
- SolidJS、TypeScript 和 Vite 构建的前端界面。
- 支持游戏库、安装、更新、启动和任务队列管理。
- Python Sophon sidecar 负责下载、补丁、进度和后台任务。
- 支持多个区域和发行渠道，并通过 channel 在构建时生成对应应用。
- 支持 Wine、DXMT 及其他运行时组件的配置和管理。
- 提供多语言界面和可替换的运行时资源。

## Screenshots

> 截图占位：后续请将图片放入 `docs/screenshots/`，并取消下面示例链接的注释。

<!--
![主界面](screenshots/main.png)
![游戏库](screenshots/game-library.png)
![设置界面](screenshots/settings.png)
-->

## Project structure

```text
.
├── src/
│   ├── clients/       # 各 channel 的客户端和发行渠道配置
│   ├── config/        # 配置、设置和数据校验
│   ├── launcher/      # 游戏库、启动流程和任务调度
│   ├── download/      # 下载队列、进度和 aria2 集成
│   ├── wine/          # Wine 运行时和发行版处理
│   ├── locale/        # 多语言资源
│   ├── assets/        # 界面素材和图片资源
│   └── icons/         # 图标资源
├── sophon_server/     # Python sidecar 服务
├── sidecar/           # aria2、7z、hpatchz、xdelta 和运行时辅助文件
├── external/          # 外部补丁和构建期间使用的资源
├── configure.sh       # 初始化配置并准备 Neutralino 运行时
├── build-sophon.sh    # 构建 Sophon sidecar
├── build-app.js       # 构建单个 macOS 应用包
├── build-all.sh       # 构建全部 release channel
├── dist/              # 前端和 Neutralino 构建产物
├── release/           # 最终 .app 输出目录
└── dev/           # 开发运行时生成的工作目录
```

`dist/`、`release/`、`dev/`、`external/` 以及其他构建输出目录均属于生成内容，通常不应提交到 Git。配置脚本生成的 `secret.ts` 等敏感配置文件也不应提交。

## Requirements

- macOS。
- Node.js 和 pnpm。
- Python 3.11 或更高版本，以及 uv。
- 构建原生辅助程序所需的 C 编译器；macOS 通常可通过 Xcode Command Line Tools 提供。
- 足够的磁盘空间，用于前端依赖、sidecar、Wine 运行时和游戏文件。

## Installation

### 使用 release

1. 前往 [Releases](https://github.com/MXJinjing/yet-another-anime-game-launcher/releases/latest) 下载对应版本。
2. 解压下载的文件，并将应用复制到 `/Applications`。
3. 不要直接从 Downloads 目录运行应用。
4. 建议将游戏文件放在用户目录下的独立目录中，例如 `~/Games/`，不要放入 `/Applications`。

### 从源码初始化

```sh
pnpm install
./configure.sh
```

`./configure.sh` 会准备 channel 配置依赖、外部目录和项目所需的 Neutralino 二进制文件。如果本地尚未生成 Sophon sidecar，请额外运行：

```sh
./build-sophon.sh
```

## Development

### 通用前端开发

```sh
pnpm dev
```

`pnpm dev` 适合进行前端界面开发。它不会自动复制 Neutralino 客户端、sidecar 或完整的桌面运行目录；如果需要启动完整的 Neutralino 应用，请使用下面对应 channel 的 `start-*` 命令。

### Channel 运行方式

以下命令会先构建开发模式前端，准备 Neutralino 和 sidecar 资源，然后启动桌面应用。

| Channel         | 命令                     | 说明                   |
| --------------- | ------------------------ | ---------------------- |
| `hk4ecn`        | `pnpm start`             | 默认开发 channel       |
| `hk4eos`        | `pnpm run start-hk4eos`  | OS 单 channel          |
| `mhyos`         | `pnpm run start-mhyos`   | OS 多 channel 整合入口 |
| `mhycn`         | `pnpm run start-mhycn`   | CN 多 channel 整合入口 |
| `hkrpgos`       | `pnpm run start-hkrpgos` | OS 单 channel          |
| `hkrpgcn`       | `pnpm run start-hkrpgcn` | CN 单 channel          |
| `bh3glb`        | `pnpm run start-bh3glb`  | Global channel         |
| `cbjq`          | `pnpm run start-cbjq`    | OS channel             |
| `cbjqcn`        | `pnpm run start-cbjqcn`  | CN channel             |
| `napos`         | `pnpm run start-napos`   | OS channel             |
| `napcn`         | `pnpm run start-napcn`   | CN channel             |
| `hk4euniversal` | 无独立 `start-*` 脚本    | 通过统一打包流程构建   |

如果需要临时切换 channel，也可以直接设置环境变量。`vite.config.ts` 会读取 `YAAGL_CHANNEL_CLIENT` 并选择对应的 `src/clients/<channel>.ts`：

```sh
YAAGL_CHANNEL_CLIENT=<channel> pnpm exec vite build --mode=development
```

## Build

完整的 release 构建、版本同步、channel/架构选择、Hosts Helper 测试和发布前检查，请参阅：

- [Release 版本构建指南](RELEASE_BUILD.zh-CN.md)

### 单 channel 前端构建

仓库提供以下快捷命令：

```sh
pnpm build
pnpm run build-hk4eos
pnpm run build-bh3glb
```

对于没有专用 `build-*` 脚本的 channel，可以使用通用命令：

```sh
YAAGL_CHANNEL_CLIENT=<channel> pnpm exec vite build
```

这些命令只构建前端资源，不会生成最终的 macOS `.app`。三种构建方式的区别如下：

- `vite build`：只构建前端资源。
- `node build-app.js`：构建并打包单个 macOS 应用。
- `./build-all.sh`：按预设列表批量构建多个 release channel。

### 单 channel 应用打包

`build-app.js` 通过 `YAAGL_CHANNEL_CLIENT` 选择 channel，通过 `YAAGL_BUILD_ARCH` 选择目标架构：

```sh
YAAGL_CHANNEL_CLIENT=hk4ecn YAAGL_BUILD_ARCH=arm64 node build-app.js
```

也可以构建其他 channel，例如：

```sh
YAAGL_CHANNEL_CLIENT=hkrpgcn YAAGL_BUILD_ARCH=arm64 node build-app.js
YAAGL_CHANNEL_CLIENT=napos YAAGL_BUILD_ARCH=arm64 node build-app.js
YAAGL_CHANNEL_CLIENT=hk4eos YAAGL_BUILD_ARCH=arm64 node build-app.js
```

支持的架构为：

- `arm64`
- `x64`
- `universal`

应用输出到：

```text
release/<architecture>/
```

### 批量构建全部 release channel

```sh
YAAGL_BUILD_ARCH=arm64 ./build-all.sh
YAAGL_BUILD_ARCH=x64 ./build-all.sh
YAAGL_BUILD_ARCH=universal ./build-all.sh
```

当前 `build-all.sh` 默认构建以下 channel：

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

`hk4eos` 虽然拥有独立的开发和构建脚本，但当前不在 `build-all.sh` 的默认批量列表中。如需单独打包，请使用：

```sh
YAAGL_CHANNEL_CLIENT=hk4eos YAAGL_BUILD_ARCH=arm64 node build-app.js
```

## Support and troubleshooting

[Discord support server](https://discord.gg/HrV52MgSC2) 是使用问题和故障排查的主要交流渠道。

提交技术问题时，请尽量提供：

- macOS 版本和芯片架构。
- 使用的 Yaaglm 版本和 channel。
- 完整的错误信息、日志或截图。
- 复现步骤，以及程序文件和数据目录的位置。
- 已尝试过的解决方法。

缺少日志和复现信息的泛化描述通常无法定位问题。涉及账户、网络或本地文件的信息请在提交前进行脱敏。

## Uninstall

1. 将应用移到废纸篓。
2. 删除对应的应用支持目录：
   - `~/Library/Application Support/Yaaglm`
   - `~/Library/Application Support/Yaaglm OS`
3. 如果使用了其他 channel，请同时检查 `~/Library/Application Support/` 下以 Yaaglm 或对应应用名称开头的目录。
4. 如需保留下载缓存、Wine 前缀或日志，请在删除前先备份相关目录。

## Related projects

- [Custom Neutralino runtime](https://github.com/3Shain/neutralinojs)：项目使用的桌面运行时分支。
- [DXMT](https://github.com/3Shain/dxmt)：图形兼容和转换组件。
- [Wine runtime project](https://github.com/yaagl/anime-game-wine)：Wine 运行时资源。
- [Linux launcher project](https://github.com/an-anime-team/anime-games-launcher)：面向 Linux 的相关启动器项目。

## Special thanks

感谢所有参与 macOS 兼容层、图形转换、下载基础设施、运行时打包和问题排查的贡献者。没有社区贡献和长期测试，项目无法持续改进。

- Krock：他的补丁让游戏在 macOS 上运行成为可能，相关工作链接可在本仓库中找到。
- rishabhroyy：感谢其宝贵的贡献与支持。

## License and safety

本项目按仓库中现有许可证和第三方组件许可使用。请在使用前阅读相关许可证、运行时组件说明和目标程序的服务条款。

使用本项目需要自行承担风险。建议先使用独立测试环境和非关键数据进行验证，并定期备份重要文件。
