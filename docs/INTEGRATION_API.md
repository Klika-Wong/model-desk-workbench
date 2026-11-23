# 接入接口规范（第三方 AI / 新执行端）

目的：让另一个 AI（或另一个程序）**只读这份文档和仓库里的文件**，就能把任务送进工作台、
拿回结果、或把自己注册成一个执行端。不需要改工作台的代码。

## 一、先选接入层级

| 层级 | 适合谁 | 你要做的事 |
| --- | --- | --- |
| A. 面板 HTTP API | 任何能发 HTTP 的程序 | 拿会话令牌，POST 任务，轮询状态与日志 |
| B. 复用仓库模块 | 本机的 Node 程序 | 直接 `require('.local-worker/../desktop/task-dispatch.cjs')` |
| C. 注册新执行端 | 你有自己的 agent/CLI，想让工作台调度它 | 写一个 worker 脚本，按第 5 节契约实现 |

下面 A、B 都能在 1 分钟内跑通；C 需要改配置，见第 5 节。

## 二、定位面板与令牌

面板只监听回环，默认 `http://127.0.0.1:8765`，若被占用会退到 `http://127.0.0.1:18765`
（本机当前实际是 18765）。发现顺序与 `desktop/panel-connector.cjs` 的 `discoverPanel` 一致。

```http
GET /api/session
→ 200 {"token": "<运行期令牌>"}
```

令牌每次启动都会变，**不要缓存到文件里**。后续请求带两个头：

- `X-Panel-Token: <token>` —— 写操作与按项目读都必需。
- `X-Model-Desk-View: <base64url(JSON)>` —— 声明你在看哪个范围。取值：
  - `{"mode":"all"}` 全部项目
  - `{"mode":"project","project":"E:\\\\某个项目"}` 单项目（必须是本机已存在的绝对目录）
  - 不带这个头 = `unbound`，`/api/tasks` 会返回 0 条，容易被误判成「任务不存在」。

编码方式：UTF-8 JSON → URL-safe base64，去掉填充。现成实现见
`.local-worker/project_scope.py` 的 `encode_view_header()`。

## 三、发任务

```http
POST /api/tasks
X-Panel-Token: <token>
X-Model-Desk-View: <view>
Content-Type: application/json

{
  "model_id": "workbuddy-deepseek-flash",
  "route_mode": "manual",
  "kind": "chat",
  "title": "连通性自测",
  "prompt": "只回复一个英文单词：PONG",
  "project": "E:\\某个项目",
  "files": [],
  "timeout": 120,
  "request_output_tokens": null,
  "routing": { "category": "other", "complexity": "simple" }
}
```

字段约束（与 `buildTaskRequest` 一致）：

- `prompt` 非空，最长 200000 字符。
- `kind` 只能是 `chat` 或 `edit`。
- `project` 必须为空串或 `X:\...` 形式的绝对目录；为空会被拒绝（403「尚未绑定项目」）。
- `timeout` 有上下限，0 表示用默认值。
- `routing.category` 取 `other/...`，`routing.complexity` 取 `simple/medium/complex`。
- **不要**自己填 token 数或费用：那是服务端按内容和任务类型估的。

成功返回 `202`，最少含 `id`：

```json
{"id": "20261123-194902-a664ff", "status": "queued"}
```

## 四、取结果

```http
GET /api/state            → 任务列表（按 view 过滤）
GET /api/tasks/<id>/log   → 事件流文本，普通文本行才是回答
GET /api/tasks/<id>/observability → 观测快照
POST /api/tasks/<id>/cancel  {"reason":"...","actor":"..."}  → 取消
POST /api/tasks/<id>/review  {...}                            → 验收结论
```

状态机：`queued → running → completed | failed | cancelled`，验收是独立的一步
（`accepted`）。**`completed` 不等于 `accepted`**，不要把两者混为一个终态。

取回答时要过滤事件流：`/log` 里以 `{` 开头的行是 JSON 事件，剩下的是正文。
空输出必须如实报告为「没有有效回答」，不要补写。

## 五、把你自己注册成执行端

工作台按 `engine` 选 worker（`panel_server.execute_task`）。要接一个新执行端：

1. 在 `.local-worker/` 下新增 `your_worker.py`，实现：
   - 读 `--run-id`，用 `model_registry.task_dir(id)` 找到 `task.json`。
   - 执行时把过程写进 `run/` 目录（日志、proof 等）。
   - 结束时 `registry.patch_task(run, status='completed'|'failed'|'cancelled', phase=..., ended_at=...)`。
   - 提供 `availability()` 返回 `{ready, name, engine, version, executable, transport, message}`，
     未安装时 `ready: false` 且 `message` 写明缺什么，**不要静默换别的引擎**。
2. 在 `execution_engines.py` 的 `AGENTS`、`LABELS`、`CONFIGURATION` 里登记 id。
3. 在 `execution_endpoints.py` 的 `IDS` 和 `defaults()` 里登记（新执行端默认 `enabled: false`）。
4. 在 `panel_server.py` 的 `execute_task` 加分派分支，并把脚本名加进 `WORKER_SCRIPTS`。
5. 写测试：至少覆盖「未安装时 fail-closed」「取消能收敛」「终态写对」。

现成例子：`pi_worker.py`（最简，195 行）、`zcode_worker.py`（原生账户型）。

### 协议选项：ACP

如果你的 agent 说 Agent Client Protocol（JSON-RPC over stdio），可以直接复用这套：
`initialize → session/new {cwd} → session/prompt`，正文来自 `session/update` 通知里的
`agent_message_chunk`。本机 OpenCode 2.4.0 实测这条链可用（见第 7 节）。

## 六、文件级契约（不经过 HTTP 也能读）

| 文件 | 作用 |
| --- | --- |
| `<project>/.model-desk/records.db` | 任务/g oal/stage 的关联索引（不是内容真源） |
| `<project>/.model-desk/runs/<id>/task.json` | **任务内容唯一真源** |
| `<project>/.model-desk/runs/<id>/prompt.txt` | 实际发出的提示词 |
| `<project>/.model-desk/runs/<id>/<engine>.log` | 执行日志 |
| `<project>/.model-desk/runs/<id>/answer.txt` | 最终回答 |

只读这些文件就能重建「这个任务发生了什么」。写入请走 worker/HTTP，不要手改 `task.json`
（它带原子替换与锁）。

## 七、最小可跑示例（本机实测）

用仓库自带的派发模块，不手拼 HTTP：

```js
const d = require('<repo>/.local-worker/../desktop/task-dispatch.cjs');
const baseUrl = 'http://127.0.0.1:18765';
const project = 'E:\\临时空目录';
const payload = d.buildTaskRequest({ prompt: '只回复一个英文单词：PONG', kind: 'chat',
  modelId: 'workbuddy-deepseek-flash', title: '连通性自测', project, timeout: 120 });
const sent = await d.dispatchTask({ baseUrl, payload, dryRun: false });
const task = await d.waitForTask({ baseUrl, taskId: sent.id, project, timeoutMs: 150000 });
const log  = await d.fetchTaskLog({ baseUrl, taskId: sent.id, project });
console.log(task.status, JSON.stringify(log.answer));
```

2026-11-23 实测：`20261123-194902-a664ff` 在 11.7 秒内 `completed`，正文 `PONG`。

ACP 直连（OpenCode）：

```js
// initialize → session/new {cwd} → session/prompt
// 实测：2810ms，stopReason=end_turn，流式正文 "PONG"
```

## 八、边界，别当成承诺

- 面板只允许回环访问，`Host`/`Origin` 不匹配会被拒绝；不要试图从外网接。
- 令牌是运行期随机值，不是长期 API key；不提供跨机器调用。
- `completed` 只说明执行器正常结束，**不代表内容通过验收**；验收要单独走 `review`。
- 失败、超时、取消都会如实记录，接口不会把「未知」写成「成功」。遇到这种返回，
  按未知处理，不要自己补一个结论。
