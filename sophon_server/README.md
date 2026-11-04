# Sophon Server

独立 FastAPI 服务端，保留 uv + protoc 31.1 + Nuitka 构建方式和旧接口。完整入门顺序见 [根目录 README](../README.md)，完整 API 基准包含在本文下方的 [API 参考](#api-参考)。

## 启动器集成

此目录整体导入独立 Sophon 项目的服务端组件，来源及本地调整见 [UPSTREAM.md](UPSTREAM.md)。终端客户端不随启动器分发。

在启动器仓库根目录运行源码服务：

```sh
uv sync --project sophon_server --locked
uv run --project sophon_server --locked python sophon_server/src/server.py --port 18765
```

构建使用 `./build-sophon.sh`（arm64）或 `SOPHON_ARCH=x64 ./build-sophon.sh`；产物仍位于 `sophon_server/build/server.dist` 和 `sophon_server/build-x64/server.dist`，启动器打包入口保持兼容。构建器生成 protobuf，附带对应架构 hpatchz，并隔离 PyCURL 的 OpenSSL 动态库。

`pnpm run test:sophon` 运行服务端测试及原有覆盖率门槛；源码按 `src/`、`proto/`、`tests/` 分开。更新源码后需等待现有任务结束再重启服务，任务 ID 不跨重启保留。

## 环境变量

| 变量 | 用途/默认 |
| --- | --- |
| SOPHON_HOST | 监听地址，默认 127.0.0.1 |
| SOPHON_PORT | 端口，默认 18765 |
| TERMINATE_WITH_PID | 可选，监控进程 PID，目标消失则退出服务 |
| SOPHON_MANIFEST_CACHE | files 压缩清单磁盘缓存，默认 ~/.cache/sophon-server/manifests |
| SOPHON_HPATCHZ | 指定原生 hpatchz/hpatchz.exe，源码运行和打包均支持 |
| SOPHON_ARCH | 构建架构，默认当前系统规范化架构，x64/arm64 |
| SOPHON_PYTHON | 指定 Nuitka 编译用 Python；设置后该环境须已装 Nuitka 和服务端依赖 |

SOPHON_SERVER_URL 是客户端变量，不改变服务端监听地址。

## 当前服务行为

- /api/history/versions：从公开索引枚举候选并确认官方清单，十分钟内存缓存。没有完整性或资源永久在线保证。
- /api/history/files：独立清单解析器，支持目录/文件、搜索、分页和刷新。首次完整清单读取不可避免；成功后缓存，目录切换和分页不重下整份清单。压缩长度/Zstd/protobuf 验证失败会重试，损坏缓存重建，磁盘写入原子替换；最多四份内存索引，保留十五分钟。
- 历史 install/sync/download/repair 默认八个文件并发，download_threads 可设 1..64；每个文件内 chunk 顺序下载。线程隔离分类和文件缓存；失败停止其他线程，不提交完整版本号。
- check 不下载，大小或大小+MD5 校验。整个目录更新并非原子事务，失败前可能已有部分文件改变。
- 下载器操作互斥，忙时 409；build、versions、files 查询和任务控制不占下载操作锁。暂停任务仍占下载锁。清单索引使用自己的锁，多个浏览首次加载可能串行，但不会阻塞下载器。
- 任务只在内存保存，状态、暂停、恢复、取消以及 WebSocket 保持原接口。可用 `GET /api/tasks` 列出全部任务。

游戏目录 .sophon/state.json 保存完整安装版本、分类、受管文件和未完成目标；单文件下载写 .sophon/download-<region>-<version>.json，不更新完整安装版本。默认下载缓存在 <gamedir>/.tmp，历史缓存按地区、版本和文件隔离。files 的全局清单缓存与任务缓存是两个用途不同的缓存；客户端不维护这些状态。

## 构建

从启动器根目录执行 `./build-sophon.sh`。可使用 `SOPHON_PYTHON` 指定已安装服务端依赖与 Nuitka 的 Python；x64 构建需要对应架构解释器。完整分发目录由启动器的 `build-app.js` 打入应用。

## 结构和按需验证

服务端源码位于 `src/`，协议位于 `proto/`，测试位于 `tests/`。构建入口为 `build.py`，启动器根目录 `build-sophon.sh` 负责选择架构和解释器。

```sh
uv run --project sophon_server --locked python -m pytest sophon_server/tests/test_processing_progress.py
```

## API 参考

本文档描述本仓库独立 Sophon Server 的当前本地 API，覆盖安装、更新、预下载、修复、在线版本查询，以及 hk4e 历史版本、指定文件下载和只检查完整性。官方 Sophon/HYP API 由服务端内部访问。现有任务接口保留 hk4e/nap 支持；历史接口和 Python CLI 当前只支持 hk4e。

### 1. 服务概览

Sophon server 是一个由 FastAPI 和 Uvicorn 提供的本地服务。启动器通常随机选择 `50000` 到 `65534` 之间的端口，并以以下地址访问：

```text
http://127.0.0.1:<port>
```

WebSocket 使用对应的地址：

```text
ws://127.0.0.1:<port>/ws/<task_id>
```

服务端入口为 `sophon_server/src/server.py`，根目录 `run-server.py` 提供启动入口。直接运行时可通过 `--port <端口>` 配置端口（范围 1–65535），优先于 `SOPHON_PORT` 环境变量。未传入该参数时，使用以下环境变量配置：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SOPHON_HOST` | `127.0.0.1` | HTTP/WebSocket 监听地址 |
| `SOPHON_PORT` | `18765` | 监听端口 |
| `TERMINATE_WITH_PID` | 未设置 | 父进程退出后终止 Sophon server |

启动器的典型调用顺序如下：

```text
启动 sophon-server
  -> GET /health
  -> GET /api/game/online_info
  -> POST /api/install|update|repair
  -> 取得 task_id
  -> 连接 WS /ws/<task_id>
  -> 接收进度事件直到 job_end、completed、job_error 或 error
```

任务在服务端内存中保存。服务重启后，任务和未发送的进度都会丢失。

### 2. 通用约定

#### 2.1 内容类型

带 JSON 请求体的接口使用：

```http
Content-Type: application/json
```

查询接口不需要特殊请求头，也不需要认证信息。服务默认只监听回环地址，因此 API 设计为本机启动器和 sidecar 之间的接口。

#### 2.2 任务状态

任务状态由服务端返回以下值之一：

| 状态 | 含义 |
| --- | --- |
| `pending` | 已创建，等待后台线程开始 |
| `running` | 正在执行 |
| `completed` | 已成功完成 |
| `failed` | 执行失败，错误信息在 `error` 中 |
| `cancelled` | 已取消，错误信息通常为 `cancelled` |

#### 2.3 字节数和速度

除非另有说明，所有大小和速度字段均使用字节：

- `download_speed_limit`: bytes/s；`0` 表示不限速。
- `install_size`、`download_size`、`total_size`: bytes。
- `overall_percent`、`progress_percent`: 0 到 100 的百分比数值。

#### 2.4 操作互斥

底层下载器使用进程全局 `OPT`，服务端通过一把锁互斥执行下载器操作。安装、更新、修复、历史任务和在线信息查询之间，忙时返回 HTTP `409`，不排队。暂停中的任务仍占用锁。历史 build 元数据和文件目录查询不使用下载器，可以与下载并行；健康检查、任务状态和任务控制接口也不占用该锁。

### 3. 安装、更新和维护 HTTP API

#### 3.1 健康检查

```http
GET /health
```

用于确认服务已启动并可以接受请求。

成功响应：

```json
{
  "status": "healthy",
  "timestamp": "2026-08-29T12:34:56.789000"
}
```

启动器通常只需要判断 HTTP 状态码为 `200`，不应依赖时间戳格式。

#### 3.2 查询在线游戏信息

```http
GET /api/game/online_info?game=<game>&reltype=<reltype>
```

查询当前渠道的在线版本和安装信息。服务端会访问官方 API，并返回统一格式。

查询参数：

| 参数 | 类型 | 可选值 | 说明 |
| --- | --- | --- | --- |
| `game` | string | `hk4e`, `nap` | 游戏类型 |
| `reltype` | string | `os`, `cn`, `bb` | 发行渠道；`bb` 分支信息只适用于 hk4e，完整下载支持见下文 |

示例：

```http
GET /api/game/online_info?game=hk4e&reltype=cn
```

成功响应：

```json
{
  "game_type": "hk4e",
  "version": "7.0.0",
  "install_size": 79271515006,
  "updatable_versions": ["6.7.0", "6.6.0"],
  "release_type": "cn",
  "pre_download": false,
  "pre_download_version": "0.0.0",
  "error": null
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `game_type` | string | 成功时为请求的游戏类型；失败时为空字符串 |
| `version` | string | 当前在线版本，如 `7.0.0` |
| `install_size` | integer | 完整安装所需的压缩 chunk 总大小；读取 manifest 失败时可能为 `0` |
| `updatable_versions` | string[] | 官方提供的可增量更新起始版本 |
| `release_type` | string | 原样返回的渠道参数 |
| `pre_download` | boolean | 是否取得预下载分支参数；不保证清单或 chunk 可用 |
| `pre_download_version` | string/null | 成功查询但没有预下载分支时为 `0.0.0`；整体查询失败时通常为 null |
| `error` | string/null | 服务端捕获异常时的错误信息 |

manifest 读取失败只记录服务端日志，仍可能返回有效版本、`install_size=0` 和 `error=null`；不能仅凭 `error=null` 判断清单或下载资源可用。`pre_download=true` 只表示成功取得预下载分支信息，未验证其 manifest 或全部 chunk 可下载。整体查询失败时，`pre_download_version` 通常为 `null`，成功但没有预下载分支时为 `0.0.0`。

#### 3.3 启动安装任务

```http
POST /api/install
```

请求体：

```json
{
  "gamedir": "/Users/example/Games/Anime Game",
  "game_type": "hk4e",
  "tempdir": "/Users/example/Games/Anime Game/.tmp",
  "download_speed_limit": 0,
  "install_reltype": "cn"
}
```

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `gamedir` | string | 是 | 游戏安装目录 |
| `game_type` | string | 是 | `hk4e` 或 `nap` |
| `tempdir` | string/null | 否 | manifest、chunk 和临时文件目录；省略时使用 `<gamedir>/.tmp` |
| `download_speed_limit` | integer | 否 | bytes/s；默认 `0`，表示不限速 |
| `install_reltype` | string | 是 | `os`、`cn` 或 `bb` |

安装目录应使用专用目录。当前空目录检查实际为目录条目数小于 2，因此不是严格的空目录校验。服务端会创建或写入 `config.ini` 并下载 `game` manifest 中的文件；不会自动下载全部语音分类。安装开始后，在文件下载完成前就会写入目标版本号，因此不能仅用 `config.ini` 判断安装成功。

`bb` 虽然可取得 hk4e 的分支信息，但当前 `make_getBuild_url` 没有 `bb` 分支，完整安装、更新、修复会在读取下载清单时失败。

#### 3.4 启动更新或预下载任务

```http
POST /api/update
```

请求体：

```json
{
  "gamedir": "/Users/example/Games/Anime Game",
  "game_type": "hk4e",
  "tempdir": "/Users/example/Games/Anime Game/.tmp",
  "download_speed_limit": 0,
  "predownload": false
}
```

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `gamedir` | string | 是 | 已安装游戏目录 |
| `game_type` | string | 是 | `hk4e` 或 `nap` |
| `tempdir` | string/null | 否 | 临时目录；省略时使用 `<gamedir>/.tmp` |
| `download_speed_limit` | integer | 否 | bytes/s；默认 `0` |
| `predownload` | boolean | 否 | `true` 表示只准备预下载资源，不应用更新；默认 `false` |

普通更新会处理删除、下载和应用 ldiff，并在完成后清理不再需要的 ldiff 文件。预下载支持取决于渠道；当前服务端允许 `os`、`cn` 使用预下载流程，禁用 `bb`；是否存在预下载分支由官方返回结果决定。

#### 3.5 启动修复任务

```http
POST /api/repair
```

请求体：

```json
{
  "gamedir": "/Users/example/Games/Anime Game",
  "game_type": "hk4e",
  "tempdir": "/Users/example/Games/Anime Game/.tmp",
  "download_speed_limit": 0,
  "repair_mode": "reliable"
}
```

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `gamedir` | string | 是 | 已安装游戏目录 |
| `game_type` | string | 是 | `hk4e` 或 `nap` |
| `tempdir` | string/null | 否 | 临时目录；省略时使用 `<gamedir>/.tmp` |
| `download_speed_limit` | integer | 否 | bytes/s；默认 `0` |
| `repair_mode` | string | 是 | `quick` 只检查文件大小；`reliable` 额外检查 MD5 |

`quick` 和 `reliable` 都是检查后自动下载、替换异常文件的修复操作，不是只检查接口。

已安装版本低于在线版本且位于官方 `updatable_versions` 中时，会先自动更新再继续修复；不在该列表中会失败。已安装版本高于在线版本时也会失败。

#### 3.6 修改下载速度限制

```http
POST /api/limit
```

请求体：

```json
{
  "download_speed_limit": 1048576
}
```

成功响应：

```json
{
  "ok": true
}
```

该限制由服务端的全局限速器执行，单位为 bytes/s；传入 `0` 表示不限速。接口不需要 `task_id`，因此它影响当前 Sophon server 进程中的下载任务。

#### 3.7 查询任务状态

```http
GET /api/tasks/<task_id>/status
```

成功响应示例：

```json
{
  "task_id": "3f5c1c1d-8cb5-4d26-b1b9-2c7a2d8f6a0f",
  "status": "running",
  "progress": null,
  "result": null,
  "last_event": null,
  "error": null
}
```

状态字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_id` | string | 任务 ID |
| `status` | string | 第 2.2 节定义的状态 |
| `progress` | number/null | 最近事件携带总体百分比时更新，0–100；尚无进度时为 null |
| `result` | object/null | 任务函数返回结果；原安装/更新/修复通常为 null，历史任务见第 11 节 |
| `last_event` | object/null | 最近一次事件快照，不是完整事件历史 |
| `error` | string/null | 失败或取消原因 |

详细进度同时通过 WebSocket 发送。CLI 可以轮询该状态接口显示进度并取得完整检查报告。

查询不存在的任务时返回 HTTP `404`：

```json
{"detail": "Task not found"}
```

#### 3.8 取消任务

```http
DELETE /api/tasks/<task_id>
```

响应：

```json
{
  "message": "Task <task_id> cancelled"
}
```

接口只设置取消事件，后台线程会在当前可取消检查点退出；因此响应返回时任务不一定已经进入 `cancelled` 状态。最终结果应以 WebSocket 的 `job_error` 或状态查询为准。

#### 3.9 暂停任务

```http
POST /api/tasks/<task_id>/pause
```

响应：

```json
{
  "message": "Task <task_id> paused"
}
```

暂停在 chunk 下载和其他显式暂停检查点生效，不会强行中断已经完成的单次网络请求或补丁操作。

#### 3.10 恢复任务

```http
POST /api/tasks/<task_id>/resume
```

响应：

```json
{
  "message": "Task <task_id> resumed"
}
```

状态查询、取消、暂停和恢复接口对于不存在的 `task_id` 均返回 HTTP 404，响应为 {"detail":"Task not found"}。

### 4. 任务创建响应

安装、更新、修复和第 11 节的历史任务接口都会立即返回，不会等待任务完成：

```json
{
  "task_id": "3f5c1c1d-8cb5-4d26-b1b9-2c7a2d8f6a0f",
  "status": "pending",
  "message": "Task started"
}
```

建议在收到响应后立即连接：

```text
ws://127.0.0.1:<port>/ws/3f5c1c1d-8cb5-4d26-b1b9-2c7a2d8f6a0f
```

### 5. WebSocket 进度 API

#### 5.1 连接

```text
ws://<host>:<port>/ws/<task_id>
```

客户端不需要先发送订阅消息。连接建立后，服务端会推送尚存的缓存事件。每个任务默认最多缓存 512 条消息，优先保留终止事件；闲置超过 300 秒的缓存会在后续缓存操作或连接时清理。如果任务已经结束且没有缓存终止事件，连接时会根据内存中的任务状态补发终止事件。事件缓存不构成完整、可重放的历史日志。每个任务只保留一个活跃连接，新连接会替换旧连接的接收位置。不存在的任务也可以建立连接，但没有状态可补发，不能用连接成功判断任务存在。

服务端对每次接收客户端文本消息设置 30 秒超时，超时后继续等待；它不会因此主动发送心跳或关闭连接。启动器无需发送业务消息。协议层 ping/pong 由 WebSocket 实现处理。

#### 5.2 通用字段

大多数事件包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 事件类型 |
| `task_id` | string | 对应的任务 ID |
| `filename` | string | 当前文件名；文件级事件通常存在 |
| `active_files` | object[] | 当前最多 8 个活跃文件 |
| `overall_progress` | object | 总体传输进度；并非所有事件都有 |

`active_files` 中的对象格式：

```json
{
  "id": "path/to/file",
  "filename": "path/to/file",
  "downloaded_size": 1048576,
  "total_size": 2097152,
  "progress_percent": 50.0,
  "download_speed": 524288.0
}
```

`overall_progress` 的传输格式：

```json
{
  "downloaded_size": 1048576,
  "total_size": 2097152,
  "overall_percent": 50.0,
  "download_speed": 524288.0
}
```

#### 5.3 通用生命周期事件

##### `job_start`

任务开始执行。

```json
{
  "type": "job_start",
  "task_id": "<task_id>"
}
```

##### `completed`

后台任务函数正常返回后，由线程包装器发送 `completed`；原操作的 result 通常为 null，历史任务的 result 为结构化对象。安装、更新、修复任务通常先在函数内发送 `job_end`，随后才发送 `completed`；客户端不应假设 `completed` 先到达，或等待两个事件均到达才结束。

```json
{
  "type": "completed",
  "task_id": "<task_id>",
  "result": null
}
```

##### `job_end`

任务函数已经完成主要工作，客户端可以关闭 WebSocket。后台线程随后才更新内存中的任务状态，因此收到终止事件时，紧接着的状态查询仍可能短暂返回 `running`。

```json
{
  "type": "job_end",
  "task_id": "<task_id>",
  "active_files": []
}
```

##### `job_error`

当前任务线程在捕获取消异常时发送，通常表示任务被取消。线程直接发送的事件不包含 `active_files`；下例中的该字段属于进度处理器能够生成的格式，客户端应把它视为可选字段。

```json
{
  "type": "job_error",
  "task_id": "<task_id>",
  "error": "cancelled",
  "active_files": []
}
```

##### `error`

任务发生未处理异常。取消和异常事件发送后，线程才更新任务状态，轮询结果可能短暂滞后。

```json
{
  "type": "error",
  "task_id": "<task_id>",
  "error": "具体错误信息"
}
```

#### 5.4 安装和普通文件下载事件

| 事件 | 关键字段 | 说明 |
| --- | --- | --- |
| `download_summary` | `game_version`, `download_size`, `download_file_count`, `download_categories` | 下载任务总览 |
| `file_download_start` | `filename`, `current_file_index`, `total_file_count` | 开始处理文件 |
| `chunk_progress` | `filename`, `total_chunks`, `current_chunk`, `progress_percent`, `current_byte`, `total_bytes`, `chunk_size` | chunk 下载/解压进度 |
| `file_progress` | `filename`, `active_files`, `overall_progress` | 文件传输进度快照 |
| `file_download_skipped` | `filename`, `reason` | 文件已存在或为目录；`reason` 常见值为 `exists`、`directory` |
| `file_download_complete` | `filename`, `file_size`, `active_files`, `overall_progress` | 文件完成并通过校验 |
| `file_download_error` | `filename`, `error` | 文件下载失败 |

示例：

```json
{
  "type": "chunk_progress",
  "task_id": "<task_id>",
  "filename": "mhypbase.dll",
  "total_chunks": 20,
  "current_chunk": "13c4da20bc589218_b965bf1d3e64ff35a28ed5cee071084c",
  "progress_percent": 25.0,
  "current_byte": 6526464,
  "total_bytes": 26125824,
  "chunk_size": 420956,
  "current_file_index": 1,
  "total_file_count": 2069,
  "active_files": [],
  "overall_progress": {
    "downloaded_size": 6526464,
    "total_size": 79271515006,
    "overall_percent": 0.0082,
    "download_speed": 524288.0
  }
}
```

`chunk_progress.total_bytes` 是解压后文件大小；`chunk_size` 是当前压缩 chunk 的传输大小，两者不能混用。

#### 5.5 修复事件

| 事件 | 关键字段 | 说明 |
| --- | --- | --- |
| `repair_summary` | `repair_mode`, `total_files` | 开始完整性检查 |
| `check_file` | `filename`, `requires_repair`, `reason`, `overall_progress` | 文件检查结果；原修复每检查 10 个文件发送一次，历史检查/修复逐文件发送 |
| `auto_update_start` | `installed_version`, `target_version` | 修复前自动更新 |

`check_file.overall_progress` 格式：

```json
{
  "total_files": 2069,
  "checked_files": 100,
  "overall_percent": 4.835
}
```

#### 5.6 更新和 ldiff 事件

删除文件：

| 事件 | 关键字段 | 说明 |
| --- | --- | --- |
| `delete_file_summary` | `total_files` | 普通游戏文件删除总览 |
| `delete_file` | `filename`, `overall_progress` | 删除一个普通文件 |
| `delete_ldiff_file_summary` | `total_files` | ldiff 文件删除总览 |
| `delete_ldiff_file` | `filename`, `overall_progress` | 删除一个 ldiff 文件 |

ldiff 下载：

| 事件 | 关键字段 | 说明 |
| --- | --- | --- |
| `ldiff_download_summary` | `ldiff_file_count`, `ldiff_total_size` | ldiff 下载总览 |
| `ldiff_download_start` | `filename`, `current_file_index`, `total_file_count` | 开始下载 ldiff |
| `ldiff_download_complete` | `filename`, `file_size`, `overall_progress` | ldiff 下载完成 |
| `ldiff_download_skipped` | `filename`, `reason` | 跳过 ldiff 下载 |
| `ldiff_download_error` | `filename`, `error` | ldiff 下载失败 |

ldiff 应用：

| 事件 | 关键字段 | 说明 |
| --- | --- | --- |
| `ldiff_patch_start` | `filename` | 开始应用补丁 |
| `ldiff_patch_complete` | `filename` | 补丁应用完成 |
| `ldiff_patch_error` | `filename`, `error` | 补丁应用失败 |
| `ldiff_patch_skipped` | `filename`, `reason` | 跳过补丁 |

### 6. 最小客户端示例

### 本地文件处理进度

`processing_progress` 是新增、兼容旧客户端的 WebSocket 事件，用于旧安装、更新及修复流程中的本地校验和补丁工作：

```json
{
  "type": "processing_progress",
  "task_id": "task-id",
  "phase": "calculating_download",
  "filename": "Data/example.bin",
  "processed_files": 12,
  "total_files": 100,
  "current_bytes": 8388608,
  "file_bytes": 16777216,
  "elapsed_seconds": 2,
  "active_files": [],
  "overall_progress": { "overall_percent": 12.0 }
}
```

- `phase` 为 `patching` 或 `calculating_download`。前者计入本轮全部补丁清单文件（包含跳过或转入分块下载的文件），后者计入待检查的目标文件。
- `processed_files` 为已处理完的文件数；百分比按文件数计算，不代表网络下载比例，也不代表当前文件已完成补丁。
- `current_bytes` / `file_bytes` 仅代表当前文件当前一次 MD5 校验的读取字节数；不累计到下载字节，原生补丁执行期间置零。
- `elapsed_seconds` 是当前文件的处理耗时。校验按读取块上报；原生补丁等待期间定期发送存活进度，事件最多每秒一次，阶段开始和最后一个文件完成立即发送。
- 完成一个文件后计数递增，包含已存在或无需修改的文件；开始下载后继续使用已有传输事件。
- 暂停、取消及下载校验规则保持原有接口；大型文件计算下载量时的 MD5 校验也检查暂停和取消。

下面的示例展示一个客户端如何启动安装、连接进度流并处理终止事件：

```python
import json
import urllib.request
from websocket import create_connection

base_url = "http://127.0.0.1:45678"

payload = {
    "gamedir": "/Users/example/Games/Anime Game",
    "game_type": "hk4e",
    "install_reltype": "cn",
    "download_speed_limit": 0,
}

request = urllib.request.Request(
    f"{base_url}/api/install",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(request) as response:
    task = json.load(response)

task_id = task["task_id"]
ws = create_connection(f"ws://127.0.0.1:45678/ws/{task_id}")
try:
    while True:
        event = json.loads(ws.recv())
        print(event["type"], event)
        if event["type"] in {"job_end", "completed", "job_error", "error"}:
            break
finally:
    ws.close()
```

生产客户端应同时处理 WebSocket 断线，并通过 `GET /api/tasks/<task_id>/status` 进行状态协调。启动器前端的参考实现位于 `src/integrations/sophon.ts`。

### 7. 错误和限制

- 请求结构或严格枚举字段（如 `game_type`、路径中的任务类型）校验失败时返回 HTTP `422`。原操作路由内部仍使用三个请求模型的 Union，但会进一步检查模型与操作是否匹配；缺少安装/修复专属字段或混用模型时返回 `422`。
- `reltype`、`install_reltype`、`repair_mode` 在模型中实际是普通字符串，并未严格限制表格列出的取值；未知值可能在业务处理中失败，非 `reliable` 的修复模式实际按快速检查处理。
- 限速字段没有非负约束，负数会被限速器归一化为 `0`，表示不限速。每次创建任务会重新设置共享限速器，可能改变已有任务的限速。
- Pydantic 默认忽略额外字段。`/api/install`、`/api/update`、`/api/repair` 不接受历史版本或指定文件语义；向这些接口发送 `version`、`files` 不会启用历史功能。请使用第 9–11 节的 `/api/history/*` 接口。
- 下载器操作互斥，忙时返回 `409`，详见第 2.4 节。每次成功创建任务仍会设置共享限速器，`/api/limit` 也会影响当前下载操作。
- `file_download_error`、进度处理器的 `job_error` 有事件生成方法，但当前主要任务路径未调用它们；实际文件失败可能直接表现为任务级 `error`。不能依赖每个失败文件都有对应文件级错误事件。
- 不存在的任务在状态查询、取消、暂停和恢复接口上均返回 `404`；服务端重启后原任务 ID 失效。
- 任务状态和进度只保存在内存中，没有持久化任务数据库。
- 默认使用单个 Uvicorn worker；服务不面向多进程共享任务状态的部署场景。
- 服务默认监听 `127.0.0.1`。如果通过 `SOPHON_HOST` 暴露到其他接口，应自行增加访问控制和网络隔离。
- 服务端当前全局关闭了 Python HTTPS 证书校验，用于访问官方远程资源；这属于实现现状，不能视为远程 API 的必要要求。
- WebSocket 事件是当前实现的 JSON 消息协议，字段可能随进度处理逻辑演进；客户端应忽略未知字段和未知事件，并以终止事件或状态查询作为任务结束依据。

### 8. 相关源码

- `sophon_server/src/api/server.py`：FastAPI 路由、任务创建和 WebSocket 入口；根层 `server.py` 负责启动。
- `sophon_server/src/api/models.py`：请求和响应模型。
- `sophon_server/src/services/operations.py`：安装、更新、修复和在线版本查询任务。
- `sophon_server/src/services/progress.py`：进度事件结构和发送逻辑。
- `sophon_server/src/infrastructure/runner.py` 和 `connections.py`：后台任务线程、消息队列和 WebSocket 连接管理。
- `sophon_server/src/services/history.py`：历史清单、指定文件、同步和只检查实现。
- `sophon-client/src/sophon_client/cli.py`：Python CLI 客户端。
- 原启动器仓库 `src/integrations/sophon.ts`：旧 HTTP/WebSocket 客户端参考。

### 9. 历史版本元数据

```http
GET /api/history/build?region=os&version=4.5.0
```

| 参数 | 类型 | 默认/约束 |
| --- | --- | --- |
| `region` | string | `os`；允许 `os`、`cn`、`bb` |
| `version` | string/null | 省略时查询当前主分支；指定时要求 `major.minor.patch` |

响应：

```json
{
  "game_type": "hk4e",
  "region": "os",
  "version": "4.5.0",
  "categories": [
    {
      "category": "game",
      "manifest_id": "manifest_...",
      "manifest_compressed_size": 4736513
    }
  ]
}
```

服务端使用当前官方分支参数访问 `getBuild`，指定版本时添加 `tag` 并严格检查返回 tag。官方返回其他版本、版本不存在或无清单时拒绝，HTTP `502` 返回 `detail`，不会回退到最新版本。此接口不保证清单中所有 chunk 仍可下载。

CLI list 使用公开历史索引和官方清单确认结果，不能保证完整覆盖所有历史版本。精确版本仍可直接通过本接口查询；客户端不再提供 versions 或 --scan。

### 10. 历史文件清单

```http
GET /api/history/files?region=os&version=4.5.0&category=game&pattern=*data_revision&offset=0&limit=100
```

| 参数 | 类型 | 默认/约束 |
| --- | --- | --- |
| `version` | string | 必填，精确版本 |
| `region` | string | `os`、`cn`、`bb`；默认 `os` |
| `category` | string | `game`、`en-us`、`zh-cn`、`ja-jp`、`ko-kr`；默认 `game` |
| `pattern` | string | 默认 `*`；按区分大小写的 fnmatch 模式匹配路径 |
| `offset` | integer | 默认 0，非负 |
| `limit` | integer | 默认 100，范围 1–1000 |

响应：

```json
{
  "version": "4.5.0",
  "region": "os",
  "category": "game",
  "total": 1,
  "offset": 0,
  "files": [
    {
      "filename": "GenshinImpact_Data/StreamingAssets/AssetBundles/data_revision",
      "size": 8,
      "md5": "de1feeda5bb6e243dcfb0e930b4584f9"
    }
  ]
}
```

`total` 为过滤后的文件数；结果不包含目录项。路径是相对游戏目录的精确路径，使用 `/`，下载时原样传递。此接口会下载并解析选定分类的 manifest，不下载游戏 chunk。上游/清单错误返回 `502`；下载器忙时返回 `409`。

### 11. 历史任务

```http
POST /api/history/<operation>
```

`operation`：`install`、`sync`、`download`、`check`、`repair`。

共同请求体示例：

```json
{
  "gamedir": "/path/to/dedicated-game-directory",
  "game_type": "hk4e",
  "region": "os",
  "version": "4.5.0",
  "categories": ["game"],
  "files": ["GenshinImpact_Data/StreamingAssets/AssetBundles/data_revision"],
  "tempdir": null,
  "download_speed_limit": 0,
  "check_mode": "reliable",
  "allow_downgrade": false
}
```

| 字段 | 类型 | 默认/说明 |
| --- | --- | --- |
| `gamedir` | string | 必填，服务端本机的专用目录，不能是盘符根目录或用户主目录 |
| `game_type` | string | 默认 `hk4e`，只允许 `hk4e` |
| `region` | string | 默认 `os`，允许 `os`、`cn`、`bb` |
| `version` | string | 必填，精确 `major.minor.patch` |
| `categories` | string[] | 默认 `["game"]`，非空；允许 game 和四种语音分类 |
| `files` | string[] | 默认空列表；精确路径，不能传通配符 |
| `tempdir` | string/null | 默认 `<gamedir>/.tmp`；内部按 history/region/version 隔离缓存 |
| `download_speed_limit` | integer | 默认 0，非负，bytes/s，共享服务端限速器 |
| `check_mode` | string | `quick` 或 `reliable`；默认 reliable |
| `allow_downgrade` | boolean | 默认 false；sync 降级需要显式 true |

操作语义：

| 操作 | 行为 |
| --- | --- |
| `install` | 下载所选完整分类。必须包含 game 分类，不能指定 files。目录需为空，或存在本工具记录的同版本中断安装状态。成功后才创建/写入 config.ini 版本号。 |
| `sync` | 使用完整 chunk 清单把已有目录同步到指定版本，可跨越旧增量更新窗口。必须包含 game，不允许 files。自动保留本工具此前登记的语音分类，并在新文件校验成功后清理上一份受管清单中的过时文件。降级需显式授权字段。 |
| `download` | 必须提供非空 files。只下载指定分类中匹配的这些文件，保留原目录结构，校验 MD5；不存在的路径会失败，不会转成整包下载。不创建或更新 config.ini，不声称整个安装已变更版本。 |
| `check` | 大小或大小+MD5 检查，只报告异常，不修复、不升级。可用 files 限定检查；为空时检查全部所选分类。允许写下载器缓存，但不替换游戏内容。 |
| `repair` | 检查并下载修复异常文件，可限定 files。已有 config.ini 版本与目标不一致时拒绝，不隐式升级历史安装。 |

新增任务入口仍立即返回原格式 `TaskResponse`（task_id/status/message），状态为 pending。版本不可用、目录不合适、文件不存在、网络失败等业务错误发生在后台任务中，通过 `failed` 和 `error` 返回。参数结构错误、下载未指定 files、install/sync 指定 files 或缺少 game 分类返回 `422`。

可通过原有状态、暂停、恢复、取消和 `/ws/<task_id>` 控制任务。状态完成后新增结果示例：

```json
{
  "version": "4.5.0",
  "operation": "check",
  "files": ["path/to/file"],
  "checked_files": 1,
  "categories": ["game"],
  "issues": [{"filename": "path/to/file", "reason": "md5 mismatch"}],
  "healthy": false
}
```

完整性有异常仍代表检查任务成功执行，因此状态为 `completed`，但 `result.healthy=false`；CLI 将其映射到退出码 2。下载/修复失败则任务状态为 failed。目录项不进行内容哈希检查。

历史任务沿用已有生命周期、传输和检查事件；check 会发送 `repair_summary`、`check_file`，不执行修复。客户端应忽略未知字段/事件，并通过最终 TaskStatus.result 取得完整检查报告。

### 12. 持久目录状态和历史资源限制

- 完整 install/sync 使用 `<gamedir>/.sophon/state.json` 保存版本、渠道、分类、文件所有权及中断目标版本。sync 只删除旧受管清单中的过时文件，保留用户额外文件。导入的外部安装若没有本工具状态，不会猜测哪些旧文件可以删除。
- 指定文件下载记录保存在 `.sophon/download-<region>-<version>.json`，不覆盖完整安装的版本记录。把其他版本文件下载到完整安装中可能产生混合版本，应使用单独目录保存历史文件，或随后按安装版本检查/修复。
- config.ini 的版本号在全部所选完整分类成功后提交；已有其他设置和注释保留。但整个目录更新不是事务，取消或失败前已经校验完成的文件可能已被替换。重新提交同一版本会跳过已正确文件并继续；不能把版本号未变理解为全部旧文件均未变。
- 下载目标及 staging 路径禁止绝对路径、Windows 盘符/反斜线、`..` 和逃逸目录的符号链接。分类重复出现同路径不同内容时拒绝。
- 历史操作使用现有 Sophon chunk 下载、解压和文件 MD5 校验，不依赖 ldiff/hpatchz。服务端旧增量更新和预下载接口仍保留原有依赖和限制；当前客户端不提供旧 advanced 入口。
- 只能访问上游仍提供清单、chunk 的历史版本。已实际验证 os/cn 4.5.0、5.0.0、5.6.0 的清单和 bb 4.5.0 元数据；os 4.5.0 的一个指定文件已实际下载、校验、检查和修复。当前探测的 os 1.0.0、3.0.0、4.0.0 无可用 Sophon 清单，不提供伪造的成功结果。
- Linux/Windows 原生构建尚未实际运行；跨平台配置和路径条件通过测试。

实现位于 `sophon_server/src/`：`api/` 提供路由和请求模型，`services/` 承担任务与版本查询，`engine/` 实现清单、下载、差分更新和修复，`infrastructure/` 提供连接管理、任务线程、限速与平台适配。内部代码和测试直接导入所属模块，不再保留旧模块名转发文件。根层只保留源码运行和 Nuitka 打包入口 `server.py` 及两个 protobuf 生成文件。

父进程监控使用跨平台进程退出方式；macOS 专用内存回收只在 macOS 执行。独立项目目录与构建命令见 README.md。

### 13. 当前 Python CLI

客户端无本地安装登记或任务记录。使用地区包名 hk4e_cn / hk4e_os / hk4e_bb；安装、检查、修复和同步必须指定游戏目录。list 查询 `/api/history/versions`，默认列出所有已索引并经官方清单确认的版本；索引可能滞后，不能宣称未知版本也已覆盖。status --dir 只读安装目录的 config.ini 和服务端 state.json，不代表完整性验证。

tasks status/pause/resume/cancel 原样映射本文第 3.7–3.10 节的任务状态及控制接口，保留完整服务端返回；tasks watch 轮询状态。tasks list 调用 GET /api/tasks，显示任务名称、ID、状态和启动时间。后台提交需要已运行的服务端，任务 ID 在重启后失效。客户端不会保存 registry.json；服务端自身的游戏目录状态与缓存机制保持不变。CLI 使用说明见 sophon-client/README.md。

#### 13.1 可下载版本目录

`GET /api/history/versions?region=cn&refresh=false`。region 支持 cn/os/bb，默认 os。服务端从 `https://raw.githubusercontent.com/orilights/pkg_version/main/hk4e_versions.json` 提取历史版本号，加入官方当前最新版本，再逐个调用官方 build 接口确认精确版本与 Sophon 清单。仅使用社区索引的版本号，下载元数据继续由官方接口提供。四个并发探测；成功结果在服务端内存缓存十分钟，refresh=true 强制重新验证。索引或最新版本获取失败返回 502；单个版本网络错误通过 errors 返回，含错误的结果不缓存。

响应字段：region、package、versions（按语义版本降序，最新优先）、latest、candidate_count、errors、source、coverage、complete、verification、cached、cache_seconds。coverage 为 indexed_history_and_current_latest，complete=false 表示不能保证社区索引覆盖所有上游版本；verification 为 official_build_manifest_available，表示确认清单而非每一个资源块仍在线。确认为 not found 的版本不列出。客户端 list 可不带包名查询三个地区，或指定包名和 @版本过滤结果。

#### 13.2 下载线程数

历史任务请求新增 download_threads，默认 8，范围 1..64，非法值返回 422。install、sync、download、repair 并行下载文件，每个文件中的 chunk 顺序下载；check 不下载且不启用下载线程池。工作线程使用独立分类描述与按文件隔离的 chunk 缓存，暂停/取消仍使用原任务控制接口。任一工作线程失败后停止其他线程，等待退出后返回失败，不提交完整安装版本。已有正确文件跳过，完成后仍逐文件校验 MD5。旧任务接口不受影响。客户端以 --threads 传递此字段，版本仅通过包名 @版本指定，已移除 --version。客户端不会启动或关闭服务端，也不再提供 --no-start-server。

#### 13.3 清单缓存和路径浏览

GET /api/history/files 新增 path（相对目录或文件）、recursive、refresh 参数。客户端总是传 path，默认 .，返回当前目录直接子项或精确文件。files 条目新增 type（directory/file）、name；目录 filename 无末尾斜杠，size/md5 为 null，文件保留原字段。客户端显示目录时不补 /。total 和 offset 均相对于本次目录/搜索结果；无此路径返回 404，非法相对路径或分类返回 400。兼容未传 path 的旧调用，仍按 pattern 全局筛选文件。

服务端缓存经压缩长度、Zstd 完整帧与 protobuf 校验的压缩清单，截断或损坏时重新下载，最多三次尝试；写入使用原子替换。默认磁盘目录 ~/.cache/sophon-server/manifests，可用 SOPHON_MANIFEST_CACHE 覆盖。解析后的目录索引最多缓存四份，十五分钟内重复请求直接复用；内存索引过期或进程重启时优先读取验证磁盘缓存，不重新下载。refresh=true 强制重取。浏览使用独立解析器，不改下载器全局 OPT，故可与下载并行；目录分页按预建索引切片，搜索结果也缓存。

客户端 files 使用 --page（默认 1）和 --count（默认 100）分页，向服务端换算 offset=(page-1)*count、limit=count；HTTP API 的 offset/limit 保持兼容。末页不显示下一页提示。

status --dir 会显示地区 cn/os/bb 和对应包名。优先读取服务端 .sophon/state.json；无该记录时，从 config.ini 的 channel=14 识别 bb，channel=1 且 sub_channel=1/0 分别识别 cn/os。缺少或无法识别的字段显示地区未知，不默认猜测；JSON 输出包含 region（未知为 null）。

list 的 TOTAL (game) 显示游戏本体文件总大小，DOWNLOAD (game) 显示官方压缩资源下载大小，均不含额外语音。大小来自验证版本时已获取的官方 manifest stats，无需下载清单；不代表更新增量、实际剩余下载量或安装所需临时空间。缺少统计时显示未知。GET /api/history/versions 新增 version_sizes（版本号 → 分类 → total_size/download_size，单位 bytes，缺失为 null）和 size_source=official_manifest_stats；保留 versions 字符串数组。JSON 包含各语音分类大小。重启旧服务端后运行 list --refresh 可获取新字段。

所有目录参数（--dir、--output、--tempdir）原样发送并由服务端展开 ~、解析相对路径及检查磁盘；相对路径基于服务端工作目录，推荐绝对路径。status --dir 调用 GET /api/history/status?gamedir=目录，服务端只读 config.ini 和 .sophon/state.json，客户端不访问本地目录。当前仍只允许本机服务地址，不启用跨机器连接；需要重启服务端加载新接口。

#### 安装目录状态接口

GET /api/history/status，必需查询参数 gamedir（非空字符串）。目录路径属于服务端机器。响应字段：directory（服务端解析后的绝对路径）、status、version、pending_version、package、region、integrity=not_checked；存在状态记录时还可包含 server_version、categories。status 可为 directory_missing、not_installed、installed、install_pending、update_pending、version_mismatch。地区未知时 region/package 为 null；不存在的目录正常返回 directory_missing，不创建目录。参数缺失/空值返回 422，非法目录或无法读取的配置返回 400。接口不下载、不校验游戏文件、不创建客户端登记。

list 按版本号从新到旧排列，最新版本在最前面（按数字比较，例如 4.10.0 排在 4.9.0 前）。

check/repair 省略 @版本时，先调用服务端 status 获取当前安装版本，再查询最新版并提示是否有更新。check 始终检查当前版本，不更新。repair 在交互终端询问是否先更新，默认否；确认后等待 update 成功，再按最新版 repair（即便 --detach 也必须先等待更新）。更新失败或取消时不提交 repair。非交互或 --json 不询问、不自动更新，继续当前版本。无法查询最新版时提示并继续当前版本；无法识别安装版本则报错，需显式指定 @版本。显式版本不触发此更新询问。

### 任务列表：`GET /api/tasks`

返回当前服务端进程内存中的所有任务，包括 pending、running、paused、completed、failed 和 cancelled，按提交顺序从新到旧排列。无任务时返回 `{"tasks": []}`。服务端重启后清空。

```json
{"tasks": [{"task_id": "uuid", "task_name": "check hk4e_cn@4.5.0", "status": "running", "started_at": "2026-10-05T00:00:00+00:00"}]}
```

`task_name` 包含操作及目标（旧任务接口仅包含操作和 game_type）。`started_at` 是任务提交启动时的 UTC ISO 8601 时间；这两个可选字段也加入单任务状态响应，缺少元数据时为 null。列表不包含完整进度和结果，详情使用 `GET /api/tasks/{task_id}/status`。

客户端：`python run-client.py tasks list`，或 `python run-client.py --json tasks list` 输出原始响应。
