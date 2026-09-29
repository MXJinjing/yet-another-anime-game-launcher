# Sophon Server API

本文档描述项目内置 Sophon sidecar 对启动器提供的本地 API。该服务负责执行游戏安装、更新、预下载、修复和在线版本查询；官方 Sophon/HYP API 由服务端内部访问，不属于本文档的调用范围。

## 1. 服务概览

Sophon server 是一个由 FastAPI 和 Uvicorn 提供的本地服务。启动器通常随机选择 `50000` 到 `65534` 之间的端口，并以以下地址访问：

```text
http://127.0.0.1:<port>
```

WebSocket 使用对应的地址：

```text
ws://127.0.0.1:<port>/ws/<task_id>
```

本文档的基准是原启动器仓库当前 Python 实现；独立项目的统一 API 文档位于 `~/Projects/yaagl-build/sophon/SOPHON_SERVER_API.zh-CN.md`；本文仍描述原启动器仓库的 Python 实现，使用时请以对应服务端的文档为准。

原仓库服务端入口为 `sophon_server/server.py`，迁移后的入口为 `sophon-server/src/server.py`。直接运行时可通过环境变量配置监听地址和端口：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SOPHON_HOST` | `127.0.0.1` | HTTP/WebSocket 监听地址 |
| `SOPHON_PORT` | `8000` | 监听端口 |
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

## 2. 通用约定

### 2.1 内容类型

带 JSON 请求体的接口使用：

```http
Content-Type: application/json
```

查询接口不需要特殊请求头，也不需要认证信息。服务默认只监听回环地址，因此 API 设计为本机启动器和 sidecar 之间的接口。

### 2.2 任务状态

任务状态由服务端返回以下值之一：

| 状态 | 含义 |
| --- | --- |
| `pending` | 已创建，等待后台线程开始 |
| `running` | 正在执行 |
| `completed` | 已成功完成 |
| `failed` | 执行失败，错误信息在 `error` 中 |
| `cancelled` | 已取消，错误信息通常为 `cancelled` |
| `""` | 查询不存在的任务时返回 |

### 2.3 字节数和速度

除非另有说明，所有大小和速度字段均使用字节：

- `download_speed_limit`: bytes/s；`0` 表示不限速。
- `install_size`、`download_size`、`total_size`: bytes。
- `overall_percent`、`progress_percent`: 0 到 100 的百分比数值。

## 3. HTTP API

### 3.1 健康检查

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

### 3.2 查询在线游戏信息

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

### 3.3 启动安装任务

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

### 3.4 启动更新或预下载任务

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

### 3.5 启动修复任务

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

### 3.6 修改下载速度限制

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

### 3.7 查询任务状态

```http
GET /api/tasks/<task_id>/status
```

成功响应示例：

```json
{
  "task_id": "3f5c1c1d-8cb5-4d26-b1b9-2c7a2d8f6a0f",
  "status": "running",
  "progress": null,
  "error": null
}
```

当前 `progress` 字段由模型保留，现有实现没有为它更新数值，通常为 `null`；详细进度通过 WebSocket 事件发送。状态响应不包含任务结果，`completed.result` 当前通常为 `null`。

查询不存在的任务时仍返回 HTTP `200`：

```json
{
  "task_id": "unknown",
  "status": "",
  "progress": null,
  "error": "Task not found"
}
```

### 3.8 取消任务

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

### 3.9 暂停任务

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

### 3.10 恢复任务

```http
POST /api/tasks/<task_id>/resume
```

响应：

```json
{
  "message": "Task <task_id> resumed"
}
```

不存在的 `task_id` 目前也会返回成功格式；调用方应通过状态查询或 WebSocket 判断任务是否真实存在。

## 4. 任务创建响应

安装、更新和修复接口都会立即返回，不会等待任务完成：

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

## 5. WebSocket 进度 API

### 5.1 连接

```text
ws://<host>:<port>/ws/<task_id>
```

客户端不需要先发送订阅消息。连接建立后，服务端会推送尚存的缓存事件。每个任务默认最多缓存 512 条消息，优先保留终止事件；闲置超过 300 秒的缓存会在后续缓存操作或连接时清理。如果任务已经结束且没有缓存终止事件，连接时会根据内存中的任务状态补发终止事件。事件缓存不构成完整、可重放的历史日志。每个任务只保留一个活跃连接，新连接会替换旧连接的接收位置。不存在的任务也可以建立连接，但没有状态可补发，不能用连接成功判断任务存在。

服务端对每次接收客户端文本消息设置 30 秒超时，超时后继续等待；它不会因此主动发送心跳或关闭连接。启动器无需发送业务消息。协议层 ping/pong 由 WebSocket 实现处理。

### 5.2 通用字段

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

### 5.3 通用生命周期事件

#### `job_start`

任务开始执行。

```json
{
  "type": "job_start",
  "task_id": "<task_id>"
}
```

#### `completed`

后台任务函数正常返回后，由线程包装器发送 `completed`。安装、更新、修复任务通常先在函数内发送 `job_end`，随后才发送 `completed`；客户端不应假设 `completed` 先到达，或等待两个事件均到达才结束。

```json
{
  "type": "completed",
  "task_id": "<task_id>",
  "result": null
}
```

#### `job_end`

任务函数已经完成主要工作，客户端可以关闭 WebSocket。后台线程随后才更新内存中的任务状态，因此收到终止事件时，紧接着的状态查询仍可能短暂返回 `running`。

```json
{
  "type": "job_end",
  "task_id": "<task_id>",
  "active_files": []
}
```

#### `job_error`

当前任务线程在捕获取消异常时发送，通常表示任务被取消。线程直接发送的事件不包含 `active_files`；下例中的该字段属于进度处理器能够生成的格式，客户端应把它视为可选字段。

```json
{
  "type": "job_error",
  "task_id": "<task_id>",
  "error": "cancelled",
  "active_files": []
}
```

#### `error`

任务发生未处理异常。取消和异常事件发送后，线程才更新任务状态，轮询结果可能短暂滞后。

```json
{
  "type": "error",
  "task_id": "<task_id>",
  "error": "具体错误信息"
}
```

### 5.4 安装和普通文件下载事件

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

### 5.5 修复事件

| 事件 | 关键字段 | 说明 |
| --- | --- | --- |
| `repair_summary` | `repair_mode`, `total_files` | 开始完整性检查 |
| `check_file` | `filename`, `requires_repair`, `reason`, `overall_progress` | 文件检查结果；当前每检查 10 个文件发送一次 |
| `auto_update_start` | `installed_version`, `target_version` | 修复前自动更新 |

`check_file.overall_progress` 格式：

```json
{
  "total_files": 2069,
  "checked_files": 100,
  "overall_percent": 4.835
}
```

### 5.6 更新和 ldiff 事件

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

## 6. 最小客户端示例

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

## 7. 错误和限制

- 请求结构或严格枚举字段（如 `game_type`、路径中的任务类型）校验失败时返回 HTTP `422`。但三个任务接口共用 `Union[InstallRequest, RepairRequest, UpdateRequest]`，操作类型与请求模型没有绑定：安装缺少 `install_reltype` 或修复缺少 `repair_mode` 仍可能被解析为 `UpdateRequest`，先返回 HTTP `200` 和任务 ID，随后后台任务失败。客户端必须按目标操作完整发送字段。
- `reltype`、`install_reltype`、`repair_mode` 在模型中实际是普通字符串，并未严格限制表格列出的取值；未知值可能在业务处理中失败，非 `reliable` 的修复模式实际按快速检查处理。
- 限速字段没有非负约束，负数会被限速器归一化为 `0`，表示不限速。每次创建任务会重新设置共享限速器，可能改变已有任务的限速。
- Pydantic 默认忽略额外字段。现有接口没有历史版本、分类选择、指定文件下载或只检查参数；发送 `version`、`files` 等未知字段不会启用这些功能。
- 当前底层下载代码使用进程全局 `OPT`，在线查询还使用固定临时目录。虽然 HTTP 层允许创建多个任务，但不能据此认为不同目录的任务和在线查询可以安全并发。客户端应串行执行涉及底层下载器的操作。
- `file_download_error`、进度处理器的 `job_error` 有事件生成方法，但当前主要任务路径未调用它们；实际文件失败可能直接表现为任务级 `error`。不能依赖每个失败文件都有对应文件级错误事件。
- 不存在的任务在取消、暂停和恢复接口上目前不会返回 `404`；调用方需要结合状态接口判断任务是否存在。
- 任务状态和进度只保存在内存中，没有持久化任务数据库。
- 默认使用单个 Uvicorn worker；服务不面向多进程共享任务状态的部署场景。
- 服务默认监听 `127.0.0.1`。如果通过 `SOPHON_HOST` 暴露到其他接口，应自行增加访问控制和网络隔离。
- 服务端当前全局关闭了 Python HTTPS 证书校验，用于访问官方远程资源；这属于实现现状，不能视为远程 API 的必要要求。
- WebSocket 事件是当前实现的 JSON 消息协议，字段可能随进度处理逻辑演进；客户端应忽略未知字段和未知事件，并以终止事件或状态查询作为任务结束依据。

## 8. 相关源码

- `sophon_server/server.py`：FastAPI 路由、任务创建和 WebSocket 入口。
- `sophon_server/models.py`：请求和响应模型。
- `sophon_server/tasks.py`：安装、更新、修复和在线版本查询任务。
- `sophon_server/progress_handlers.py`：进度事件结构和发送逻辑。
- `sophon_server/utils.py`：后台线程、消息队列和 WebSocket 连接管理。
- `src/integrations/sophon.ts`：启动器侧 HTTP/WebSocket 客户端参考实现。
