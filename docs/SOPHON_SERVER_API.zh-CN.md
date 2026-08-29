# Sophon Server API

本文档描述项目内置 Sophon sidecar 对启动器提供的本地 API。该服务负责执行游戏安装、更新、预下载、修复和在线版本查询；官方 Sophon/HYP API 由服务端内部访问，不属于本文档的调用范围。

## 1. 服务概览

Sophon server 是一个由 FastAPI 和 Uvicorn 提供的本地服务。启动器通常随机选择 `40000` 到 `65534` 之间的端口，并以以下地址访问：

```text
http://127.0.0.1:<port>
```

WebSocket 使用对应的地址：

```text
ws://127.0.0.1:<port>/ws/<task_id>
```

服务端入口为 `sophon_server/server.py`。直接运行时可通过环境变量配置监听地址和端口：

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
| `reltype` | string | `os`, `cn`, `bb` | 发行渠道；当前 `bb` 仅部分游戏适用 |

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
| `pre_download` | boolean | 是否存在可用预下载分支 |
| `pre_download_version` | string/null | 预下载版本；没有时为 `0.0.0` |
| `error` | string/null | 服务端捕获异常时的错误信息 |

服务端可能在 manifest 读取失败时仍返回版本信息，此时应检查 `error` 和 `install_size`。

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

安装目录通常应为空，服务端会在其中创建或写入游戏文件。安装任务会下载完整的 `game` manifest 中的文件。

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

普通更新会处理删除、下载和应用 ldiff，并在完成后清理不再需要的 ldiff 文件。预下载支持取决于渠道；当前服务端只允许海外渠道使用完整预下载流程。

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

如果已安装版本低于在线版本，修复任务可能先自动执行一次更新，再继续修复。

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

当前 `progress` 字段由模型保留，实际详细进度通过 WebSocket 事件发送，通常为 `null`。

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

客户端不需要先发送订阅消息。连接建立后，服务端会推送缓存的进度事件；如果任务已经结束，也会补发对应的终止事件。

服务端每 30 秒等待一次客户端文本消息，以保持连接；启动器无需发送业务消息，但可以发送任意文本作为保活消息。

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

后台任务函数正常返回。通常随后还会发送 `job_end`。

```json
{
  "type": "completed",
  "task_id": "<task_id>",
  "result": null
}
```

#### `job_end`

任务成功结束，客户端可以关闭 WebSocket。

```json
{
  "type": "job_end",
  "task_id": "<task_id>",
  "active_files": []
}
```

#### `job_error`

任务被取消或以可识别的任务错误结束。

```json
{
  "type": "job_error",
  "task_id": "<task_id>",
  "error": "cancelled",
  "active_files": []
}
```

#### `error`

任务发生未处理异常。

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

- 参数校验失败时，FastAPI/Pydantic 通常返回 HTTP `422` 及验证错误详情。
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
