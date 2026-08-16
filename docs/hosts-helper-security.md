# hosts-helper 安全加固契约（Route A：纯哈希固定 + 多 channel 权限验证）

本文档是 R2/R3 各子任务的**唯一契约**。所有实现必须严格按本文档字段、格式与语义，不得自行决策。
除非先修改本文档（先改文档再改代码），否则协议/格式任何偏差均视为缺陷。

---

## 1. 注册表 `/var/db/yaaglm-hosts-helper.registry`

- 权限：`0600 root:wheel`；仅 install.sh（root）写入；并发写用 `flock`（锁文件 `/var/db/yaaglm-hosts-helper.lock`）+ 临时文件 `rename` 原子替换。
- 格式：每行一条记录，`|` 分隔，6 个字段（C 端只使用前 5 个，第 6 个供 uninstall 使用）：
  ```
  bundle_id|version|launcher_sha256|client_sha256|token|token_path
  ```
  例：`com.3shain.yaaglm.cn|1.0.0|<64hex>|<64hex>|<64hex>|/Users/x/Library/Application Support/Yaaglm/tokens/com.3shain.yaaglm.cn.token`
- 字段约束：
  - `bundle_id`：`[A-Za-z0-9.-]`，长度 1..128。
  - `version`：`[A-Za-z0-9.+-]`，长度 1..64。
  - `launcher_sha256` / `client_sha256` / `token`：64 位小写 hex。
  - `token_path`：绝对路径，长度 ≤ 1024。
- 行首 `#` 为注释，空行忽略。
- 守护进程在每次请求前 `stat` 注册表，`mtime`/`size` 变化即重新加载（注册表很小，无需常驻缓存策略）。

## 2. 线上协议（Unix socket `/var/run/yaaglm-hosts-helper.sock`，0666）

请求为单行，空格分隔，末尾 `\n`，总长 ≤ 8191 字节：

```
AUTH <bundle_id> <version> <token> <CMD> [args...]
```

命令（与旧版一致，仅前置 AUTH）：
- `STATUS`
- `ENSURE <count> <ip> <domain>...`（count ≤ 64；ip/domain 校验同旧版）
- `BLOCK <ttl> <count> <ip> <domain>...`（ttl 1..3600）
- `UNBLOCK`

响应为单行：
- `OK <registered_version>`（STATUS 成功；registered_version 为注册表该行 version）
- `OK ensured` / `OK blocked` / `OK unblocked`
- `ERR_UNREGISTERED` / `ERR_VERSION_MISMATCH` / `ERR_TAMPERED` / `ERR_UNAUTHORIZED` / `ERR_RATE_LIMITED`

客户端退出码：响应以 `OK` 开头 → 0；否则打印响应行到 stdout 并退出：
`10=UNREGISTERED, 11=VERSION_MISMATCH, 12=TAMPERED, 13=UNAUTHORIZED, 14=RATE_LIMITED`。

### 客户端 CLI（TS 调用方式）
```
yaaglm-hosts-helper --request <bundle_id> <version> <action> [action args...] --token-file <path>
```
- action：`status | ensure | block | unblock`；`ensure` 后接 ip/domain 对；`block` 后接 `<ttl> ip domain...`。
- `--token-file <path>` 必填；客户端进程自己读取该文件（取首个非空行并 trim），拼入 `AUTH` 行。
- **token 内容绝不进 argv / 命令行 / 日志**；argv 中只允许出现 token 文件路径。

## 3. 守护进程校验顺序（任一失败即拒绝并审计）

1. `getpeereid`：peer uid 必须为 0 或等于 `stat("/dev/console").st_uid`，否则 `ERR_UNAUTHORIZED`。
2. 读取请求行并解析 `AUTH`；`bundle_id`/`version`/`token` 按第 1 节字符集校验，非法 → `ERR_UNAUTHORIZED`。
3. 按 `bundle_id` 查注册表；无该行 → `ERR_UNREGISTERED`。
4. 对端身份（hash 失败标记 `hash_fail`）：
   - `getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID)` 取 peer pid（macOS 10.15+）；
   - `proc_pidpath` 取 peer 路径，对文件算 SHA-256，必须等于该行 `client_sha256`，否则 `hash_fail=true`；
   - 祖先链：`pid=peer_pid`，循环 ≤4 次：`proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info))` 取 `pbi_ppid`；若 `ppid<=1` 停止；对 `ppid` 进程 `proc_pidpath` + SHA-256，等于该行 `launcher_sha256` 则 `launcher_found=true` 并停止；否则 `pid=ppid` 继续。
   - `launcher_found==false` → `hash_fail=true`。
5. token 常量时间比较（XOR 累加，禁 memcmp）与该行 token，不匹配 → `ERR_UNAUTHORIZED`。
6. 版本规则：
   - `!hash_fail`（无论 version 是否相等）→ 继续执行命令；STATUS 返回 `OK <registered_version>`（版本漂移由 TS 侧通过比较版本决定是否重注册）；
   - `hash_fail && request_version == row.version` → `ERR_TAMPERED`（拒绝，**绝不重注册**）；
   - `hash_fail && request_version != row.version` → `ERR_VERSION_MISMATCH`。
7. 限流：per-bundle_id 令牌桶 20 次/分钟，超限 → `ERR_RATE_LIMITED`；`BLOCK` 的延迟 unblock 子进程全局上限 8，超限 → `ERR_RATE_LIMITED`。
8. 执行命令：条目校验、TTL 校验与旧版一致；`system()` 替换为 `fork + execve("/usr/bin/dscacheutil", ["dscacheutil", "-flushcache"], NULL)`（子进程 `_exit(127)` 兜底）。
9. 审计：追加写 `/var/log/yaaglm-hosts-helper.log`（0600）：`<ISO8601> <peer_uid> <bundle_id> <CMD> <entry_count> <result>`；**不记录 token**。

### 哈希缓存
- 键：`(pid, path, size, mtime, inode)`；值：sha256 + 计算时间；TTL 5 秒；容量上限 128，超出淘汰最旧。

## 4. 构建产物 `Contents/Resources/build-manifest.json`

```json
{
  "bundleId": "com.3shain.yaaglm.cn",
  "version": "1.0.0",
  "appName": "Yaaglm",
  "launcherPath": "MacOS/Yaaglm",
  "launcherSha256": "<64hex>",
  "clientSha256": "<64hex>",
  "helperSha256": "<64hex>"
}
```
- `launcherPath` 相对 `Contents`；`launcherSha256` 为 `Contents/<launcherPath>` 在 **codesign 之后**的 SHA-256。
- `clientSha256` 与 `helperSha256` 均为 `Resources/sidecar/yaaglm-hosts-helper/yaaglm-hosts-helper` 在 codesign 之后的 SHA-256（同一文件）。
- `version` 取自 `neutralino.config.json` 的 `version`；`appName` 为发行名（如 `Yaaglm`、`Yaaglm HSR`）。
- 签名方式：对 launcher 二进制与 helper 二进制执行 `codesign --force --options runtime --sign -`（ad-hoc + hardened runtime）；顺序为「先签名、后算哈希」。
- `parameterized`（`Contents/MacOS/parameterized`）在 exec 前增加：`export YAAGL_BUNDLE_PATH="$(dirname "$CONTENTS_DIR")"`（值为 .app 路径，如 `/Applications/Yaaglm.app`）。

## 5. install.sh / uninstall.sh

### install.sh
- 调用：`install.sh --bundle <appBundlePath> --helper <bundle内helper二进制>`；必须以 root 运行。
- **信任门禁**（不满足 → 退出码 2）：`<appBundlePath>` 为目录且含 `Contents/Info.plist` 与 `Contents/Resources/build-manifest.json`；`appBundlePath`、`Contents/Info.plist`、launcher 二进制、helper 二进制均须：非符号链接、属主 uid==0、无 group/other 写位。
- bundle_id：`/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" <appBundlePath>/Contents/Info.plist`。
- 哈希：`shasum -a 256` 从磁盘**自行计算**（launcher、client），不信任 manifest 的哈希值（manifest 仅作参考与版本来源）。
- helper 安装幂等：`/Library/PrivilegedHelperTools/yaaglm-hosts-helper` 缺失或哈希 != helperSha256 时 `install -o root -g wheel -m 0755` 并复验；随后写 plist（内容沿用现状）、`chown root:wheel`、`chmod 0644`、`launchctl bootout`（忽略错误）→ `bootstrap` → `kickstart`。
- token：注册表已有该 bundle_id 行 → 保留原 token；否则 `openssl rand -hex 32` 生成。用户侧写入 `~/Library/Application Support/<appName>/tokens/<bundle_id>.token`：目录 0700、文件 0600、属主 = `stat -f %u /dev/console`（无登录用户则 root）。
- 注册表 upsert：`flock` 锁 → 读 → 替换/追加该 bundle_id 行 → 临时文件 → `rename`；第 6 字段 `token_path` 写入用户侧 token 绝对路径。
- 退出码：0 成功（含幂等 no-op）/ 1 错误 / 2 不可信 bundle。

### uninstall.sh
- 调用：`uninstall.sh <bundle_id>`；必须以 root 运行。
- `flock` 后从注册表删除该行（读取该行的 `token_path` 并删除该文件）。
- 若删除后注册表为空 → 完整卸载：`launchctl bootout`、删除 helper 二进制/plist/socket；否则仅删行，**不动**其他 channel。
- 退出码：0 成功 / 1 错误。

## 6. TS 集成语义

- 运行时身份来源：`build-manifest.json`（bundleId/version/appName，运行时位于 `resolve("./build-manifest.json")`）；bundle 路径来自 env `YAAGL_BUNDLE_PATH`（`Neutralino.os.getEnv`）。
- 可信判定：`YAAGL_BUNDLE_PATH` 存在 **且** `build-manifest.json` 可读 → 可信；否则 **不可信**：零 helper 调用、直接 legacy 降级（`legacyBlockHosts`/`legacyEnsureHosts`），不弹管理员框、不尝试注册。
- helperArgs：`["--request", bundleId, version, action, ...]` + `--token-file <resolve("./tokens/<bundleId>.token")>`。
- ensureHelperReady（STATUS 分流）：
  - `OK <v>`：`v == manifest.version` → 就绪；`v != manifest.version` 且可信 → 触发 install.sh 重注册后重试；
  - `ERR_UNREGISTERED` 且可信 → 触发 install.sh（首次安装）后重试；
  - `ERR_VERSION_MISMATCH` 且可信 → 触发 install.sh 后重试；
  - `ERR_TAMPERED` → UI 告警 + 降级，**绝不**自动重注册；
  - `ERR_UNAUTHORIZED` / 其他 → 降级。
- `installPrivilegedHostsHelper`：`exec(["/bin/sh", installScriptPath(), "--bundle", bundlePath, "--helper", helperPath()], {}, true)`；`uninstallPrivilegedHostsHelper`：`exec(["/bin/sh", uninstallScriptPath(), bundleId], {}, true)`。
- 状态枚举：`running | installed-stopped | not-installed | error | untrusted | tampered`；`hosts-helper.tsx` 展示新增状态。
- 删除运行时 `cc` 编译分支（`ensureLocalHelperBinary` 不再编译，仅检查可执行；缺失即 helper 不可用）。
- legacy 路径（`legacyBlockHosts`/`legacyEnsureHosts`）逻辑与测试保持不变。

## 7. C 自测 `--self-test`

非 root 可运行；覆盖：`valid_ip`/`valid_domain` 边界、`parse_entries` 数量/TTL 边界、注册表行解析、常量时间比较、`AUTH` 头解析。输出 `PASS` 或 `FAIL <name>`；全过退出 0，否则 1。
