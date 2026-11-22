# dsh-sweeper

[![CI](https://github.com/Dushiqi1987/dsh-sweeper/actions/workflows/ci.yml/badge.svg)](https://github.com/Dushiqi1987/dsh-sweeper/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

静态扫描历史会话里的工具产物，分两档展示；你自己勾选，点「清理选中」批量移到插件回收站，可随时恢复。

## 怎么用

装好后，DSH 设置的左侧栏出现「清理对话垃圾」。打开它：

0. 四个页签：**扫描结果**（静态）· **模型复核**（可选，一次模型调用给整份清单评档）· **深度清理**（可选，按对话问模型）· **回收站**。
1. 静态读取所有会话的工具执行流（`tool/call` / `tool/result` / `job/*`），不需要模型参与，不产生对话，不花 token。
2. 建一份产物账本：每个被 `write`/`edit` 写过的文件、每个 `dsh-spill` 落盘文件，记录产生它的会话、轮次、工具、时间，以及之后有没有被**工具再次使用**。
3. 与磁盘对账（是否存在、大小、mtime），按两档列出：

| 档位 | 条件 |
|---|---|
| **无脑删** | 位于 `.scratch/`、`tmp/`、`temp/`、`__pycache__`、`*.bak` 等临时目录（或 `%TEMP%/dsh-spill-*`），产生后再没被任何工具当文件用过，且最后活动时间早于 7 天前 |
| **不确定** | 同上但之后被工具用过；或产生它的工具调用失败过（半成品）；或超过 1 MB |

两条硬规则：

- 一周内**被工具用过**的，不进列表（只在顶部「保护」里计数）。
- 清理 = `rename` 进 `DSH_HOME/plugin-data/dsh-sweeper/trash/<批次>/`，并写 `manifest.json`；不调用 `unlink` 删用户文件。

## 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/plugins/dsh-sweeper/report` | 报告 JSON（`?refresh=1` 强制重扫，默认缓存 60s）；含一次性 `token` |
| POST | `/plugins/dsh-sweeper/delete` | `{token, keys, confirmed:true, acknowledge?}`，把选中项移进回收站 |
| GET | `/plugins/dsh-sweeper/trash` | 回收站批次列表 |
| POST | `/plugins/dsh-sweeper/restore` | `{batchId}`，整批恢复 |
| POST | `/plugins/dsh-sweeper/purge` | `{batchId, confirmed:true}`，永久删除该批次 |
| GET | `/plugins/dsh-sweeper/deep/plan` | 深度清理预演：哪些闲置对话会被送进模型、各带多少候选、预计 token（`?refresh=1` 强制，默认缓存 60s） |
| POST | `/plugins/dsh-sweeper/deep/start` | `{token, consent:true}`，启动深度分析（最多 4 段并发），立即返回 `jobId`；未带 `consent` 返回 400 |
| GET | `/plugins/dsh-sweeper/deep/status` | 当前任务进度与已收集结果（客户端每 900ms 拉一次） |
| POST | `/plugins/dsh-sweeper/deep/cancel` | `{jobId}`，停止派发新的对话，已返回的结果保留 |
| GET | `/plugins/dsh-sweeper/health` | 扫描状态 |

POST 必须带 `x-dsh-sweeper: 1` 头（跨站请求无法携带自定义头，借此挡掉 CSRF）；`token` 与最近一次扫描绑定，过期或重扫后失效；选中「不确定」项时必须 `acknowledge: true`。

**每个路由在进入处理前都先过 DSH 自己的浏览器信任检查**：优先调 `ctx.connection.requestRejection(req)`（与 `/api` 同一套判定），该服务缺席时退化为 fail-closed 兜底——`sec-fetch-site: cross-site`、`Origin` 与 `Host` 不同源、`Host` 不是 loopback，三者任一命中即 403。因此浏览器里打开的任意网页既读不到报告，也调不动删除：未认证的请求连根路径都是 401。

## 深度清理（可选，第四页签）

前两个页签看的是「这次扫描能找到什么」。深度清理换一个问题：**这个对话当时生成的东西，现在还有用吗？**——这只有读过那段上下文才能判断，所以它把**闲置满 7 天**的对话摘要发给你的模型，让模型只回答「哪几个文件可以丢」。

1. 点「深度清理」，先出一份**预演**：会分析哪几个对话、各自带多少候选、一共预计花多少 token。此时代码只读日志和文件大小，不发任何网络请求。候选只取**已经像临时产物的东西**（`.scratch`、`tmp`、`__pycache__`、`*.bak`、spill 文件……）——把 `package.json`、源码、配置发给模型，只会花 token 换回一句「保留」。一段对话如果没留下这类文件，直接跳过，预演里会写「N 段无临时产物已跳过」。
2. 勾选「我明白会消耗 token」再点「开始分析」。最多 **4 段对话同时**发；**谁先回来就先在页面上显示谁的结果**，进度条和每行状态实时更新。
3. 模型按行回答 `S i3 理由`（无脑删）/ `O i3 理由`（可选删）/ `K i3`（留着）。回来的编号在插件侧重新核对一遍：文件还在、大小没变、没被 git 跟踪、不是链接、不在 `~/.dsh` 里——任一条不满足就丢弃，并出现在「未通过校验」里。
4. 结果同样分两档：**S 且确实在临时目录** → 无脑删；**S 但不在临时目录，或只回了 O** → 可选删。两档都要你点按钮才会移动，移动仍是进回收站。

发给模型的内容：标题、工作目录、起止与闲置天数、工具调用统计、用户最初那句请求（截断 900 字）、最近一次回答（截断 1400 字）、最近 22 条工具调用（只留命令/路径）、以及候选文件的编号清单。**不发原始日志、不发附件内容、不写入任何会话。**

坏一台机器/换模型的代价也考虑到了：模型调用失败的那一段会把原因写在自己的行上（“此时不会有任何文件被移动”），不影响其它段。

## 删除前的兜底检查

`lib/trash.js` 对每个待移动的路径独立复核，任何一条不满足就跳过：

- 必须是绝对路径、不带 `..`、不在盘符根/一级目录；
- 不在 `DSH_HOME`（sessions / storages / attachments / profiles）或 `~/.agents` 之内；
- `realpath` 必须等于原路径（穿过链接/联接点的拒绝）；
- 必须是普通文件，大小与 mtime 与扫描时一致（扫描后被改过就跳过）；
- 跨卷时退化为「复制 + 删源」，任一步失败就不动原文件。

## 边界

- 不给模型注册任何工具。
- 不发任何外部网络请求。
- 报告只含路径与元数据，不含对话正文。

## 模型复核（可选，第三页签）

`POST /plugins/dsh-sweeper/review {token, autoDelete?, model?, timeoutMs?, debug?}`

把当前扫描结果的**摘要**（最多 100 条，短编号 `i1…iN`，只含路径/档位/类型/大小/闲置天数/是否失败）交给宿主模型服务（`ctx.get('llm')`，默认取 `agentDefaultModel.currentSelection()`，本机是 `opencode-go / deepseek-v4.1-flash`），让它逐行回答：

```
D i12          → 删
K i30          → 留
Q i24 问题      → 问用户
```

约束（提示词 + 代码双层）：
- 模型**只能引用编号**，输不出文件操作；插件侧不做 shell、不拼命令行、不执行模型给的任何字符串。
- 返回里 `tier === 'safe'` 的 `D` 才会自动进回收站；`tier === 'unsure'` 的 `D` 一律降级为「询问用户」。
- 编号对不上的（乱编、大小写变体、路径回显）进 `unknown`，直接丢弃（fail-closed）。
- 模型调用失败 → 502，**一个文件都不动**。
- 所有「删」都是 `rename` 进回收站，可在「回收站」页签整批恢复。

调用方也可不开自动清理：`autoDelete: false` 只返回建议，由前端按钮逐条确认。

### 让模型顺便「发现」新垃圾

除了给定候选，插件还会把**已知临时目录里从没出现在任何会话日志中的旧文件**（`.scratch/`、`tmp/`、`__pycache__/`、`dsh-spill-*` 内，深度 3，跳过 `node_modules/.git/.venv/dist/build` 等，只取 7 天前修改的）作为 B 段清单 `x1…xN` 一起交给模型，让它分两类：

```
A x12          → 可以直接清理（无脑删档）
S x30          → 可选清理（有价值但可删，交给用户勾选）
K x44          → 留着
```

返回的每一项都要过 `vetProposals()` 复检才会展示：key 必须在本轮 hints 里、`lstat` 必须是普通文件且不是链接、大小与 mtime 未变（±2s）、不超过 50 MB、`git ls-files` 确认未跟踪。没过的进 `extra.rejected` 并在界面上折叠显示，**不会被执行**。

- 前端：`extra.sweep` 给一个「清理这 N 项」按钮；`extra.optional` 是复选框，勾完才走 `/delete {extra:true}`。
- 想连这部分也自动清：`/review {extraAuto: true}`（默认关）。
- 扫描范围硬限制：**系统临时目录整根不扫**（`%TEMP%` 里有别的程序的文件），只认 `dsh-spill-*` 这种 DSH 自己建的目录；含 U+FFFD 或 `[object` 的坏路径直接丢弃。

## 移植到别的电脑

代码里**没有任何绝对路径**、没有用户名、没有盘符假设。所有根目录都是运行时算出来的：

| 用途 | 来源 |
|---|---|
| DSH 主目录 | `$DSH_HOME`，没设就是 `~/.dsh` |
| 回收站 | `<DSH 主目录>/plugin-data/dsh-sweeper/trash`（自动创建） |
| 候选路径 | 从目标机器自己的会话日志里解析，不预置任何目录 |
| 临时目录根 | `os.tmpdir()`，并且**整根不扫**，只认其中的 `dsh-spill-*` |
| 模型 | 目标机器的 `agentDefaultModel.currentSelection()` |

`lib/paths.js` 统一处理分隔符、大小写、盘符与 POSIX 路径，Windows / macOS / Linux 走同一套判断。

在别人的电脑上装：

1. 把整个 `dsh-sweeper` 目录拷过去（`node_modules` 不用带，本插件零运行时依赖）。
2. `plugin_manager` → `install_bundle`，target 指向那个目录。
3. 打开设置左栏的「清理对话垃圾」。

依赖只有两个：目标 DSH 版本要提供 `sessionPersistence` / `webServer` / `settings.section`（缺了会在插件加载时报错，不会静默）；`git` 是可选的，没有它只是 `gitTracked` 那一道校验变成「未知」，其余四道照旧。

## 上线硬化（v1.0）

- **并发**：同一时刻只允许一次扫描、一次模型复核，重复请求返回 `409`。
- **令牌**：`token` 与「当前这一份报告」绑定；报告不重建就不换 token，多次 GET 可以共用一个 token；重扫或恢复后自动作废。
- **缓存**：`GET /report` 默认复用 60 秒内的结果（`?refresh=1` 强制重扫）；缓存判定用首次发布时间，不会因为反复刷新而永不重扫。
- **恢复**：`restore` 会逐条校验 manifest 里的原始路径（绝对盘符、无 `..`、不落在 `~/.dsh`、`~/.agents`、回收站自身），失败条目保留在批次里，全部成功才删批次目录。
- **复制完整性**：跨卷搬运后校验目标大小与原文件一致，不一致就反向搬回并报错。
- **错误可见**：服务端异常写入 `/report.lastError` 与 `/health.error`，页面顶部显示可重试的错误卡片。
- **接口约定**：所有写接口要求 `x-dsh-sweeper: 1` 头；`/delete` 还需 `token` + `confirmed:true`；勾选包含「不确定」项时再加 `acknowledge:true`。
- **访问检查**：六个路由统一走 DSH 的 `requestRejection`（缺服务时 fail-closed 兜底），未认证请求 401、跨站请求 403；这一层与 `x-dsh-sweeper` 头互为纵深，不是替代。

### 复核页签的回归检查

```bash
node test/browser/check.mjs        # 需要本机有 Chrome/Edge，或 CHROME=<path>
```

它启动回放服务、用无头浏览器点开「模型复核」并按一次「让模型复核」，然后**等到复核之后那次报告刷新落地**，再确认判定卡片还在屏幕上。v1.2.5 的那个 bug（结果刚出来就被刷新清空）就是它盯着的；把 `load(force, keepReview)` 改回无条件 `setReview(null)`，这条检查会红。

## 边界与自保

- **重新扫描不会打断正在跑的深度分析**：报告换了，但运行中的那一轮继续，页面继续轮询；结果里的每个路径在移动前都会对磁盘重新校验。
- **模型读报告期间如果你重扫了**，这一轮复核会被丢弃并返回 409，什么都不移动——判定针对的是你刚才看的那份报告。
- **读不出来的会话日志**只让那一段从计划里消失，不会让整份计划失败；页面会写「N 段日志读不出来」。
- 客户端断开连接时，请求体读取会立刻放弃，不会留下一个永远挂起的处理函数。

## 验证记录

「模型给出的候选真的会出现在页面上」这件事怎么验证的、哪些是自动化的、哪一步需要人在桌前点：见 [docs/verification.md](docs/verification.md)。

## 自测

仓库自带两套检查，`git push` 后由 GitHub Actions 在 **Node 14.21.3 / 20 / 22** 三个版本上跑：

```bash
node --check lib/*.js test/harness.js scripts/selfcheck.mjs   # 语法
node scripts/selfcheck.mjs                                    # 清单 + 补丁 + 语言文件

cd test && npm install && npm test                            # 12 个 UI 状态的 SSR 冒烟
```

`selfcheck` 检查的是商店和 `dsh plugin add` 真正会看的东西：`dsh.bundle.patch` 存在、`cordis.patch.yml` 里有 `insert` 且有 `id`/`name`（且 `name` 等于包名）、`exports` 与 `files` 里的路径都真实存在、两份 locale 都有 `meta.title` 与 `meta.description`。任何一个不满足就退出码非 0。

CI 里还有一步 `npm pack` 后检查 tarball 里确实有 `package/cordis.patch.yml` —— 这一条最容易在「本地能装、发出去装不上」时踩到。

Node 14 是特意留着的：宿主运行时就是 `v14.21.3`，插件在这上面必须能 `import`（`node:` 前缀、`??=`、可选链这些都不能越界）。

装好以后还可以让插件自己跑一遍只读回归（不发对话、不动文件）：

```bash
echo '{"go":true}' > "$HOME/.dsh/plugin-data/dsh-sweeper/selftest.json"
# 重载插件后约 30 秒，结果出现在同目录的 selftest-out.json
```

它依次走 `report → deep/plan → deep/start(maxSessions:1) → deep/status`，把每一步的状态码、条数和深度清理的候选写成 JSON，并记一条 **timeline**（每 2 秒采样各对话的状态），用来看「谁先返回先更新」是否真的在逐行推进。**绝不会调用 `/delete`、`/purge`**，跑完自动删掉触发器。

本机一轮实测（12 段闲置对话）：过滤后只剩 1 段真正留有临时产物、5 个文件，预计 **994 tokens**（过滤前是 13,697）；分析用 8.4 秒，5 个文件全部被模型判为可删，行状态按 `queued → done` 逐行变化。

额外的手工预览（不在 CI 里，需要本机装过 DSH）：

```bash
cd uitest && npm i && node harness.js   # 同 test/，路径指向本仓库
node preview.js                         # 生成 ../preview.html 静态预览
```

### 会话文件夹

老会话的日志头里可能没有 `cwd`，页面上就会显示「未知目录」。这时用 DSH 自己维护的 `~/.dsh/storages/workspace.json`（侧栏那份工作区登记表）按会话 id 反查文件夹，显示真实的 `D:/OpenFuture` 这样的路径，摘要里也会带上它——模型知道文件属于哪个项目，判断会更准。

### 真浏览器回放（test/browser）

SSR 冒烟只能证明「组件拿到这份 JSON 不会崩」。要看真实浏览器里**先返回先显示**的动效，用这一套：它起一个本地假后端（数据形状与真实接口一致），加载**真实的 `lib/client.js`**，然后用无头浏览器点开「深度清理」页签、勾同意、点开始，再把几个时刻截下来。

```bash
node test/browser/server.mjs                 # http://127.0.0.1:8731/
# 另开一个终端：
chrome --headless=new --hide-scrollbars --window-size=1180,1600 \
  --virtual-time-budget=20000 --screenshot=done.png \
  "http://127.0.0.1:8731/?stop=16000"
```

`?stop=` 是让页面自动点按钮的时长（毫秒），假后端按**轮询次数**推进：第 2 次轮询第 2 段完成、第 3 次第 3 段、第 4 次第 1 段——所以截图里三段分别是 1.5s / 1.9s / 2.3s 完成，而不是最后一起变。它只用于开发验证，不发布、不进 CI。

**回放真实模型输出**：加 `REAL=1`，服务器改读 `~/.dsh/plugin-data/dsh-sweeper/selftest-out.json` 里那次真实自测的 `deep` 结果，页面看到的就是模型当时的原话和理由：

```bash
REAL=1 PORT=8737 node test/browser/server.mjs
```

判定结果按轮询逐个放出来，所以能同时看到「会话已完成、候选一条条冒出来」的过程，而不是一次刷出全部。

复核页签也能这样回放：`http://127.0.0.1:8731/?mode=review&stop=4000`——它点开「模型复核」、按一次「让模型复核」，假后端把抓到的真实响应返回给页面。这一套抓出过一个真 bug：`load()` 在复核结束后的刷新里把 `review` 一并清空了，结果刚出来就消失（v1.2.5 修：复核后的那次刷新 `load(false, true)` 保留结果）。
点「停止」不只是把界面上的状态改掉：正在流式返回的模型调用会被 abort，队列里还没开始的对话不再发出去（本机实测：1 段对话、4 秒时点停止，`job.state=cancelled`、耗时 6.0 秒，模型那边的流当场断开）。

