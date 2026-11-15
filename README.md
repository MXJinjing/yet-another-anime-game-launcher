# Yet Another Anime Game Launcher Modified (Yaaglm)

[简体中文](docs/README.zh-CN.md)

> **⚠️ Personal Fork Notice**
>
> **This repository is a personally built fork named Yaaglm for personal testing, customization, and maintenance. It is not an official upstream release.**

## Current Supported Game Version:

### GI: 5.3.0+ OS/CN **
### HSR: 4.3.0+ OS/CN
### ZZZ: 3.0.0+ OS/CN

#### **: Starting from release 0.3.12 using DXMT 0.74, you need to update to Sequoia or later. Sonoma is getting old and is lacking technical features to improve the translation.

<!-- ## Policy

Please don't link to this repository. If you really want to share it with people, just tell the project name __Yaaglm__ and where to find (Github!) but __don't share/disclose the link__ unless it's a private message.

Do __not__ provide any forms of tutorial for _how to use Yaaglm_ on public channels. (If you really want to do that, ask the project owner for permission first.)

Do __not__ mention the real name of the game or the game company, in code commits, issues, pr or dicussions. Use _The Anime Game_ or _The Anime Company_ instead.

Just follow these, or share and ruin this project for all other macOS (including Linux as well) players. -->

<!-- ### Hall of Shame

This is a list of people/organization violating Yaaglm policies -->

## Is it safe?

Use it at your own risk. Or enjoying it with a new f2p account.

## For Linux users

[Anime Games Launcher](https://github.com/an-anime-team/anime-games-launcher) is a universal linux launcher for anime games

Yaaglm is a macOS desktop launcher for managing Windows game programs from different regions and distribution channels. It provides a unified interface, download and update workflows, game library management, runtime configuration, and Wine-based launch support.

The target channel is selected at build time through `YAAGL_CHANNEL_CLIENT`. A channel may represent a region, a distribution channel, or a merged multi-game entry point. Each channel uses its corresponding client configuration, resource endpoints, and runtime settings.

> This project is intended for users who are familiar with macOS, the terminal, and Windows compatibility layers. Before using it, make sure you understand the system requirements, file locations, and backup procedures for the relevant programs.

## Features

- Lightweight macOS desktop application based on Neutralinojs.
- Frontend built with SolidJS, TypeScript, and Vite.
- Game library, installation, update, launch, and task queue management.
- HK4E, HKRPG, and NAP use Swift Sophon for install, update, predownload, and integrity checks. BH3 and CBJQ use Aria2.
- Multiple regions and distribution channels selected at build time.
- Wine, DXMT, and other runtime components can be configured and managed.
- Localized interface and replaceable runtime resources.

## Screenshots

> Screenshot placeholders: add images to `docs/screenshots/` later and uncomment the example links below.

<!--
![Main interface](docs/screenshots/main.png)
![Game library](docs/screenshots/game-library.png)
![Settings](docs/screenshots/settings.png)
-->

## Project structure

```text
.
├── src/
│   ├── clients/       # Client and distribution-channel configurations
│   ├── config/        # Configuration, settings, and validation
│   ├── launcher/      # Game library, launch flow, and task scheduling
│   ├── download/      # Download queue, progress, and aria2 integration
│   ├── wine/          # Wine runtime and distribution handling
│   ├── locale/        # Localization resources
│   ├── assets/        # Interface assets and images
│   └── icons/         # Icon resources
├── sophon_server/     # Swift Sophon source copy and legacy API source
├── sidecar/           # aria2, 7z, hpatchz, xdelta, and runtime helpers
├── external/          # External patches and build-time resources
├── configure.sh       # Initialize configuration and Neutralino runtime
├── build-sophon.sh    # Build the Sophon sidecar
├── build-app.js       # Build one macOS application bundle
├── scripts/build-release.sh # Build all release channels
├── dist/              # Frontend and Neutralino build output
├── release/           # Final .app output directory
└── dev/           # Generated development runtime directories
```

`dist/`, `release/`, `dev/`, `external/`, and other build-output directories are generated content and generally should not be committed to Git. Sensitive configuration files such as the generated `secret.ts` must not be committed either.

## Requirements

- macOS.
- Node.js and pnpm.
- Swift 6.3 or later with Xcode for the Sophon sidecar. Python and uv are used when running the legacy API tests.
- A C compiler for native helper programs; on macOS this is typically provided by Xcode Command Line Tools.
- Enough disk space for frontend dependencies, sidecars, Wine runtimes, and game files.

## Install

- Go to [Release](https://github.com/MXJinjing/yet-another-anime-game-launcher/releases/latest) and download the latest version.
- Uncompress and copy the resulting application to your `/Applications` folder. (Do not open the application from Downloads folder.)
- Also make sure your game files aren't stored inside `/Applications`, use something inside your home folder instead, e.g `Games/GI`.

### From source

```sh
pnpm install
./configure.sh
```

`./configure.sh` prepares channel configuration dependencies, external directories, and the Neutralino binaries required by the project. If the Sophon sidecar has not been generated locally, run:

```sh
./build-sophon.sh
```

## Development

### Frontend development

```sh
pnpm dev
```

`pnpm dev` is intended for frontend interface development. It does not automatically copy the Neutralino client, sidecars, or a complete desktop runtime directory. Use the channel-specific `start-*` command below to launch the full Neutralino application.

### Running each channel

The following commands build the development frontend, prepare Neutralino and sidecar resources, and launch the desktop application.

| Channel | Command | Notes |
| --- | --- | --- |
| `hk4ecn` | `pnpm start` | Default development channel |
| `hk4eos` | `pnpm run start-hk4eos` | OS single channel |
| `mhyos` | `pnpm run start-mhyos` | OS merged multi-channel entry point |
| `mhycn` | `pnpm run start-mhycn` | CN merged multi-channel entry point |
| `hkrpgos` | `pnpm run start-hkrpgos` | OS single channel |
| `hkrpgcn` | `pnpm run start-hkrpgcn` | CN single channel |
| `bh3glb` | `pnpm run start-bh3glb` | Global channel |
| `cbjq` | `pnpm run start-cbjq` | OS channel |
| `cbjqcn` | `pnpm run start-cbjqcn` | CN channel |
| `napos` | `pnpm run start-napos` | OS channel |
| `napcn` | `pnpm run start-napcn` | CN channel |
| `hk4euniversal` | No dedicated `start-*` script | Build through the unified packaging flow |

To temporarily select a channel, set `YAAGL_CHANNEL_CLIENT`. `vite.config.ts` reads this variable and selects `src/clients/<channel>.ts`:

```sh
YAAGL_CHANNEL_CLIENT=<channel> pnpm exec vite build --mode=development
```

## Build

### Single-channel frontend build

The repository provides these shortcut commands:

```sh
pnpm build
pnpm run build-hk4eos
pnpm run build-bh3glb
```

For channels without a dedicated `build-*` script, use:

```sh
YAAGL_CHANNEL_CLIENT=<channel> pnpm exec vite build
```

These commands build frontend resources only; they do not create the final macOS `.app`. The three build modes are:

- `vite build`: build frontend resources only.
- `node build-app.js`: build and package one macOS application.
- `bash scripts/build-release.sh`: package all release channels for one architecture.

### Package one channel

`build-app.js` selects the channel through `YAAGL_CHANNEL_CLIENT` and the target architecture through `YAAGL_BUILD_ARCH`:

```sh
YAAGL_CHANNEL_CLIENT=hk4ecn YAAGL_BUILD_ARCH=arm64 node build-app.js
```

Other examples:

```sh
YAAGL_CHANNEL_CLIENT=hkrpgcn YAAGL_BUILD_ARCH=arm64 node build-app.js
YAAGL_CHANNEL_CLIENT=napos YAAGL_BUILD_ARCH=arm64 node build-app.js
YAAGL_CHANNEL_CLIENT=hk4eos YAAGL_BUILD_ARCH=arm64 node build-app.js
```

Supported architectures:

- `arm64`
- `x64`
- `universal`

Applications are written to:

```text
release/<architecture>/
```

### Build all release channels

```sh
export YAAGL_VERSION="$(node -p 'require("./package.json").version')"
YAAGL_BUILD_ARCH=arm64 bash scripts/build-release.sh
YAAGL_BUILD_ARCH=x64 bash scripts/build-release.sh
YAAGL_BUILD_ARCH=universal bash scripts/build-release.sh
```

Run the command for the architecture you need after preparing its Sophon sidecar. A universal build needs both sidecar architectures. The [release script](scripts/build-release.sh) lists the channels, including `hk4eos` and `all`, and writes the archives to `release-assets/<architecture>/`.

## Uninstall (completely)

1. If Hosts-Helper is enabled, open the in-app settings to uninstall it.
2. In **Global Settings → General → Launcher Data**, choose **Clear Launcher Data** and confirm. Yaaglm moves the current channel's settings, logs, caches, and local Wine environment to the Trash, then quits.
3. Move the app to the Trash.

To locate the folder manually, open Finder, choose **Go → Go to Folder…** (Shift–Command–G), enter `~/Library/Application Support/`, and press Return. Find the folder for your channel, such as `Yaaglm GI CN`, `Yaaglm OS`, or `com.3shain.yaaglm` for the all-channel build. You can also choose **Open in Finder** under **Launcher Data** while Yaaglm is running. Quit Yaaglm before moving the folder to the Trash.

## Related projects

* Custom `neutralinojs` binary from [3Shain/neutralinojs](https://github.com/3Shain/neutralinojs)
* [DXMT](https://github.com/3Shain/dxmt)
* Custom Wine from [anime-game-wine](https://github.com/yaagl/anime-game-wine)

## Special thanks

* An Anime Team
* Krock, the game running on macOS can not come true without his patch (you can find the link to his work in this repository, while you have to make a little effort ;) )

* mkrsym1, tackled IMO the most challenging AC component. It's a really remarkable and mind-blowing achievement.
* rishabhroyy: The multi-channel merging logic and UI of this project starter reference the code from his forked repository.

## License and safety

This project is used according to the licenses in the repository and the licenses of its third-party components. Review the relevant licenses, runtime documentation, and the terms of service of the programs you use with it.

You are responsible for evaluating the risks of using this project. Start with an isolated test environment and non-critical data, and keep backups of important files.
