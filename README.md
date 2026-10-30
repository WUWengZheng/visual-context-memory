# Visual Context Memory

**面向 Codex 的本地项目记忆工作台：可视化关系、人工可控编辑、不可变版本与可追溯来源。**

Visual Context Memory（VCM）由 **Codex Skill + 本地 Node.js 应用 + SQLite 数据库 + Cytoscape 网页界面**组成，帮助你保存和查阅长期项目中的事实、决策、约束、需求及问题，并说明一次回答参考了哪些已保存记忆。

这是 MIT 开源的**本地预览版本**，不是托管记忆服务。需要完整应用目录，不能只下载一个 `SKILL.md`。目前不自动抓取全部聊天，也不提供云同步或语义检索。

Local, source-backed project memory for Codex. Human-controlled editing, immutable revisions, bounded graph/keyword recall, and per-reply attribution. Requires Node.js 24+.

[下载完整源码 ZIP](https://github.com/WUWengZheng/visual-context-memory/archive/refs/heads/main.zip) · [Skill 指令](SKILL.md) · [HTTP API](references/http-api.md) · [MIT License](LICENSE)

## 目录

- [一句话交给 Agent](#一句话交给-agent)
- [功能与边界](#功能与边界)
- [快速安装](#快速安装)
- [启动、停止与日常使用](#启动停止与日常使用)
- [数据位置与配置](#数据位置与配置)
- [记忆、版本与指标](#记忆版本与指标)
- [检索、图谱与导出](#检索图谱与导出)
- [每次回复的记忆使用说明](#每次回复的记忆使用说明)
- [常见问题](#常见问题)
- [本地安全与隐私](#本地安全与隐私)
- [测试与验证](#测试与验证)
- [开发与贡献](#开发与贡献)
- [许可证与技术来源](#许可证与技术来源)

## 一句话交给 Agent

把下面**完整一句话**发送给有终端和网络权限的 Codex / Agent：

> 请从 https://github.com/WUWengZheng/visual-context-memory 下载完整仓库到新的临时目录，先阅读 README.md 和 SKILL.md、记录所用 commit 并检查 Node.js 24+、npm 及现有安装，再在仓库目录运行 node scripts/setup.mjs 完成安装与只读就绪检查，保留已有数据库且不覆盖现有安装，最后告诉我启动 Viewer 和调用 Skill 的方法。

这句话授权该次下载与安装，不授权替换已有安装、搬迁数据库、安装系统 Node、公开数据或自动执行记忆编辑。遇到已有安装或环境缺失，Agent 应报告原因和下一步，而不是删除目录重试。

不要只说“下载 SKILL.md”，也不要默认通用 Skill 下载器会替你完成 Node 依赖、数据库路径和启动配置。本仓库的安装入口是 `scripts/setup.mjs`。

## 功能与边界

| 能力 | 当前实现 |
| --- | --- |
| 项目隔离 | 每条记忆归属一个 Project，检索和图谱保留项目范围 |
| 可视化工作台 | Library / Graph / Inspector 三栏，窄屏有可打开/关闭的面板 |
| 记忆管理 | 人工新增、编辑、Lock / Unlock、Pin / Unpin、Importance 与生命周期操作 |
| 版本与来源 | 修改创建新 Revision，旧版本不覆盖；查看来源、事件、历史与字段 Diff |
| 备注与删除 | Note 新增/软删除，Memory 软删除与恢复 |
| 高风险操作 | Merge、Supersede、已有 Conflict 人工解决；真实后端预览和过期计划检查 |
| 实验指标 | 已有 Metric 的数值与 Observation 原子修改，保留 Dataset / Split / Protocol / Run / Checkpoint |
| 有界检索 | 最多五个字面关键词查询的排名融合，可选一跳关系扩展 |
| 渐进式读取 | `view=compact` 先看候选，再按准确 Revision 读取完整详情 |
| Markdown 导出 | 导出单条已保存的 Current Revision、来源、备注及指标范围 |
| 回复透明度 | Skill 参与的最终回复要求说明检索、参考、引用、可见但未采用的记录 |

**当前不提供：**自动聊天提取、自动冲突识别、embedding / 语义检索、通用中文分词、Context Builder / Context Preview、自动云同步、账号系统、全局回复拦截器、永久记忆使用日志，以及普通手工新建流程中的新作用域 Metric / 批量导入。

SQLite 是数据真源。Markdown 导出不是双向同步协议，也不是完整数据库备份或已承诺可往返导入的格式。

## 快速安装

### 运行环境

- **Node.js 24 或更高版本**，包含 npm；安装器会检查，不会自动更换你的系统运行时。
- 安装依赖时需要 npm 网络访问，或者已有可用缓存。
- 程序本身无需 OpenAI API Key、向量数据库或云端记忆账号；Codex 自身的使用和登录独立于本应用。
- 当前实际验收环境为 **macOS + Node 24 + Chrome**；Windows / Linux 完整安装流程没有实机认证。

### 方式 A：下载 ZIP 后安装

1. [下载完整源码 ZIP](https://github.com/WUWengZheng/visual-context-memory/archive/refs/heads/main.zip)，解压。
2. 在解压后的应用目录：
   - macOS：打开 `Install.command`。
   - 终端备用入口（包括 Linux）：运行 `node scripts/setup.mjs`。
   - Windows：提供 `Install.cmd`，但 Windows 实机路径未验证；也可在终端运行相同 Node 命令。
3. 安装器打印安装目录、数据路径、依赖安装和就绪检查结果。
4. 保留打印出来的数据路径说明，再按下一节启动。

macOS 可能要求正常批准终端执行或安全提示；安装器不会绕过 Gatekeeper。若解压没有保留可执行权限，可在终端进入目录运行 `bash Install.command` 或上述 Node 命令。Finder 双击和隔离标记的跨机器行为不能仅由 CLI 测试保证。

### 方式 B：使用 Git

在没有同名下载目录的位置运行：

```sh
git clone --depth 1 https://github.com/WUWengZheng/visual-context-memory.git
cd visual-context-memory
node scripts/setup.mjs
```

如需复现某一版本，应先记录并核对所下载的 commit；`main` 会随开发更新。不要在未经核对的已有目录上覆盖解压。

### 安装器会做什么

- 默认安装到 `~/.agents/skills/visual-context-memory`，以当前 [Codex 官方 Skill 发现规则](https://learn.chatgpt.com/docs/build-skills) 为依据。
- 复制与发布打包相同的**源码白名单**，不复制私有数据库、`node_modules`、本地安装配置或测试输出。
- 使用锁文件安装依赖：`npm ci --ignore-scripts --no-audit --no-fund`，然后运行只读 `doctor`。
- 生成 `Start Viewer.command` / `Start Viewer.cmd` 和 `Check Setup` 入口。
- 保存绝对数据库路径与端口到安装目录的私有 `vcm-install.json`。
- **不创建数据库、不启动后台服务、不改 Codex 全局配置、不自动更新已有安装。**

已有目标目录时返回 `INSTALL_EXISTS`，不会覆盖。默认安装检测到旧 `~/.codex/skills/visual-context-memory` 时也会停止，防止不经审查出现两份安装。

需要自定义位置或继续使用明确已有数据库时：

```sh
node scripts/setup.mjs --dest /absolute/custom/visual-context-memory --db /absolute/private/memory.db --port 4173
```

数据库必须位于安装目录之外。目录名可以有空格，但在终端传参时应正确引用。使用与当前 Codex 版本匹配的发现目录；`--dest` 不会自动让任意目录变成可发现位置。

`--skip-deps` 是高级“仅复制”选项，不代表已可运行；之后仍需安装依赖并通过 `doctor`。

### 只运行源码，不安装 Skill

如果只想试网页，可不写个人 Skill 目录：

```sh
npm ci --ignore-scripts
npm start
```

这会在本应用目录使用独立的 `.visual-context-memory/memory.db`，不会自动把 Skill 注册到 Codex。

## 启动、停止与日常使用

### 启动 Viewer

安装完成后，在**打印的安装目录**：

- 打开 `Start Viewer.command`；Windows 对应文件为 `Start Viewer.cmd`。
- 或在终端运行：

```sh
npm start
```

启动后显示实际地址，通常为 `http://127.0.0.1:4173`。快捷启动会尝试交给系统浏览器打开；失败时手动打开打印的 URL。浏览器中不需要另建应用账号。

服务在前台运行，终端窗口需保持打开，**Ctrl+C 停止**。没有开机自启或后台守护程序。

可从其他工作目录调用绝对路径启动器：

```sh
node /absolute/install/visual-context-memory/scripts/vcm.mjs start --open
```

默认端口被占用时会报错，不会杀掉其他进程，也不会偷偷换端口。测试可用端口 0 请求系统随机端口，日常使用应保存稳定端口并始终使用实际打印的地址。

### 首次创建

1. 选择 **Create your first project**，输入 Project 名称。
2. 点击 **New memory**，输入名称、要记住的内容和类型。
3. 保存后产生 Revision 1、人工提交来源和审计记录。
4. 在 Library 点击记录，查看 Graph 中的节点和 Inspector 详情。

不必先导入演示数据，也不要让 Agent 为了填满空库而编造事实。

### 在 Codex 中调用

安装后可明确输入：

```text
$visual-context-memory
本地服务地址是 http://127.0.0.1:4173。
请查阅“我的项目”的现有约束，再回答这次设计问题，
并在末尾说明实际引用的记忆、版本和来源。
```

Skill 会确认服务和项目，进行有界检索，读取需要的完整详情，再给出有来源的回答。多个项目都合理时应先澄清，不混用其他项目。

若 Skill 没出现，检查发现目录并重启 Codex。安装成功不表示旧聊天已自动加载它，也不表示每一个未使用此 Skill 的聊天都会附加记忆说明。

### 日常维护

- 点击节点 → Inspector 只读查看 → **Edit** → 修改 → 保存新 Revision。
- 新的决定要由你明确要求保存，或在网页手动新增。
- 将不再适用的知识标记 Outdated，而不是改写旧历史。
- 合并、替代、删除和 Conflict 解决先查看真实影响预览，再明确确认。

切换节点/项目或离开编辑时有未保存草稿，会要求继续编辑或明确放弃。保存失败保留草稿；网络中断的写操作可能已提交，应刷新 Current / history 只读核对，不能盲目重复提交。

## 数据位置与配置

| 场景 | 默认数据库位置 |
| --- | --- |
| 全新安装器安装 | `~/.local/share/visual-context-memory/memory.db` |
| 未安装的源码运行 | 本应用目录的 `.visual-context-memory/memory.db` |
| 源码/下载目录发现旧库后安装 | 继续引用该旧库的原物理路径，不复制或迁移 |
| 显式指定数据库 | `--db` / `VCM_DB_PATH` 指定的位置 |

安装程序发现旧库时会提示你保留原目录；**不能安装完就把包含旧库的下载目录一起删掉**。

安装配置示例（仅结构示例，不是应复制的用户路径）：

```json
{
  "schemaVersion": 1,
  "dbPath": "/absolute/private/memory.db",
  "port": 4173
}
```

`VCM_DB_PATH` / `VCM_PORT` 在启动时可显式覆盖保存的配置；相对环境变量路径按调用者工作目录解析。不要设置后忘记，否则可能有意外的数据范围。安装器配置和生成的启动文件均不进入源码包。

### 就绪检查

在安装或源码目录运行：

```sh
npm run doctor
```

检查 Node、SQLite、Cytoscape、配置和数据文件是否存在；**不打开数据库、不创建数据、不启动服务**。它不证明端口可用、业务数据正确或 Codex 已发现 Skill。

### 备份和升级

- 先停止服务，再备份数据库和安装配置；不要只复制一个正在写入的 SQLite 主文件而忽略 WAL。
- 单条 Markdown 导出不是整个库的备份。
- 当前安装器没有“覆盖升级”或自动卸载功能；替换代码前单独审查并备份，保留库及正确配置。
- 不要把新旧目录、真实库和 DEMO 库混在一起，也不要通过删除安装目录来“修复”不明写入结果。
- 不要直接改历史 migration 或不可变 Revision。

## 记忆、版本与指标

七类顶层 Memory：

| 类型 | 含义 |
| --- | --- |
| `entity` | 模块、方法、数据集、实验、文件等命名对象 |
| `fact` | 观察、事实性断言或指标结果 |
| `decision` | 已作出的选择或计划 |
| `constraint` | 技术、实验或流程边界 |
| `requirement` | 功能、质量或验收要求 |
| `issue` | 问题、风险或未解决事项 |
| `resolution` | 已提出或确认的解决办法 |

`Metric` 是 `fact / metric_observation` 加专门的 Observation，不是第八类。普通新建表单不支持创建新作用域的 Metric；已有 Metric 编辑会同步 raw / numeric 值，并保留 Dataset、Split、Protocol、Run、Checkpoint 等范围。另一个 Run 或 Checkpoint 应是另一条观测，不作为同一数值的普通纠错。

- **Lock**：保护记录免受非人工修改；明确的人工编辑仍允许，保存后继续 Locked。
- **Pin**：独立的置顶/优先提示，不是 Lock，也不授予编辑权限。
- **Revision**：语义修改创建新版本；不把旧 Revision 直接设为 Current。
- **版本冲突**：客户端提交 `expectedRevisionId`，浏览器编辑的服务端事务检查失败返回 `409 REVISION_MISMATCH`，不能静默合并旧表单。
- **来源**：人工新建的 `manual_input` 保存实际提交的名称/摘要/描述，不伪造聊天 session/message ID；`user_confirmed` 和 confidence 表示提交/审阅状态，不是客观真实性保证。

详见 [Schema](references/memory-schema.md)、[生命周期](references/memory-lifecycle.md)、[Editor 合约](references/memory-editor.md) 与 [Conflict 规则](references/conflict-rules.md)。

## 检索、图谱与导出

### 有界 Recall

- SQLite FTS/BM25 字面关键词匹配，最多五个查询用 Reciprocal Rank Fusion 合并。
- 项目、Type、Lifecycle、Locked、Pinned 条件在 limit 之前应用。
- Recall 默认 active；显式查询历史生命周期用于审阅，不能当作当前结论。
- 可选一跳扩展：最多五个直接命中种子，每个最多二十个符合条件的邻居。
- 排名、匹配理由和截断信息不是真实性或模型置信度。
- 不是 embedding 检索；连续中文句子内部的任意子串不保证命中。

### Compact 候选

`view=compact` 保留准确 Memory/Revision ID、排序与范围，名称最多120 Unicode code points、摘要最多320、来源标识最多8个，并显式说明省略/截断。默认 `view=full` 保持兼容。

候选预览不是完整证据。引用、编辑或判断 Metric 范围前，要读取准确版本的完整详情。若 Current 已变化，应重新审阅，不能把旧预览静默提升为新版本引用。

### 图谱和列表

Graph 提供 Project / 1-hop / 2-hop 视图；Recall 关系扩展仅支持一跳，二者不是同一个参数。取消 Inspector 选择不会丢掉已有邻域中心和深度。

Library/Search 最多加载100项，Graph 最多200节点，显示“已加载/匹配”数量和部分结果提示；这些不是整个项目的全部记忆数量。Rejected 默认隐藏，显式选择后可审阅。复杂查询应缩小条件或按需翻页，不一次下载全库。

### Markdown 导出

Inspector 的 **Export Markdown** 导出当前已保存的 Revision，包含来源、备注和 Metric 范围。未保存草稿不会被导出；服务端版本变更会要求重新读取。导出最大2 MiB，超限明确失败，不默默截掉证据。

文档可能含私人原文、Notes 和路径。导出不授权上传、公开共享或导入另一套记忆系统。

完整契约见 [Recall 与导出](references/recall-and-export.md)。

## 每次回复的记忆使用说明

加载并遵循本 Skill 的 Agent 应在每次最终回复附加：

- 实际检索返回哪些候选；
- 取得并核对了哪些准确版本的详情；
- 明确参考/引用了哪些记忆，支持哪个用途或结论；
- 本次可见但未明确引用的记录，以及已知的未采用原因；
- Memory / Revision / Source 身份、已有来源定位及查询范围；
- 零命中、未查询、失败、取消和截断分别说明。

未返回的记忆没有逐条审核，不能编造“全库未使用清单”；没有记录未采用原因时不能猜测。只作为参考不等于完全没用。

`src/client/reply-memory-session.mjs` 提供可选的临时只读采集器，观察经自身返回的真实 HTTP 数据，校验引用的项目/版本和详情读取条件。调用者声明“参考/引用”不证明模型内部因果，也不保证正文一定包含声明的结论。

这不是全局 Codex hook、所有聊天的自动接线、签名审计、平台真实 reply ID 或永久使用日志。未经过采集器的工具读取必须根据实际输出另外报告。默认隐藏完整私人路径，不在说明中粘贴原始证据/Notes。

详见 [回复报告与集成](references/reply-memory-report.md)。

## 常见问题

| 情况 | 处理 |
| --- | --- |
| 找不到 Node 或版本过低 | 安装 Node.js 24+（含 npm），重开终端；安装器不会替换系统运行时 |
| `INSTALL_EXISTS` / `LEGACY_INSTALL_EXISTS` | 先检查已有安装、备份和数据库配置；不要删目录盲重装 |
| npm 安装失败 | 保留文件，在安装目录执行 `npm ci --ignore-scripts`，再 `npm run doctor`；setup不会覆盖重试 |
| 仅复制后无法启动 | `--skip-deps` 不包含依赖安装；完成 npm 安装后检查就绪状态 |
| `EADDRINUSE` | 查明端口占用；明确选择其他端口，不杀未知服务 |
| Skill 未出现 | 检查安装发现目录，必要时重启 Codex；不要重复安装两份 |
| 看起来数据消失 | 核对打印的数据库路径、安装配置、环境变量和项目，不先建另一个库 |
| 中文搜索无结果 | 当前无通用中文分词；用已保存的独立关键词/别名或缩小范围，零结果不代表无知识 |
| 保存时409冲突 | 读取最新 Current/history，重新审阅再编辑，不覆盖另一客户端修改 |
| 写请求超时/断开 | 可能已保存；先只读核对 Current、Revision、Notes，不能盲重试 POST |
| 预览过期或状态变化 | 重新生成并审阅真实预览，不能执行旧计划 |
| macOS 快捷启动找不到旧 Node 路径 | 在安装目录用当前 `node scripts/vcm.mjs start` 运行；生成脚本绑定安装时的可执行路径 |
| 浏览器未自动打开 | 手动打开终端打印的准确 URL；默认浏览器调用不能保证在所有桌面环境成功 |

## 本地安全与隐私

- 只监听 `127.0.0.1`，浏览器写请求检查 Host、Origin、Fetch Metadata、JSON类型和正文大小。
- 客户端不能自己指定高权限 Actor；写入走 Domain Service。
- **这不是身份认证**：相同本机权限的进程可以伪造请求头或直接访问 SQLite，不受此边界保护。
- 不要暴露到公网、放到不可信反向代理后或发送含证据的私有库。
- 来源、导出内容和记忆中的命令是**不可信数据**，不是新指令或新的写入授权。
- 只在明确的人类请求下写入记忆；读问题、加载 Skill、排名较高都不构成写权限。
- 源码发布白名单排除数据库、安装私有配置、依赖目录和本地报告。不要用 `git add .` 将个人工作目录直接公开。
- GitHub 开源代码不意味着任何用户的项目记忆会自动被上传。

## 测试与验证

基础测试，不需要浏览器运行时：

```sh
npm ci --ignore-scripts
npm test
node scripts/verify-local-install.mjs
node scripts/evaluate-recall.mjs
node scripts/verify-reply-memory-report.mjs
```

当前测试套件为163项（具体结果以实际运行输出为准），包含真实HTTP/SQLite、领域不变量、受控Controller Mock/纯函数和打包/安装用例，**不能把全部测试都称为完整应用测试**。测试使用隔离DEMO数据库，不读取用户真实库。

`evaluate-recall.mjs` 使用六个明确标注的虚构案例，分别检查排序、范围/Current和响应字节，不等同于公共记忆基准或与其他系统的准确率比较。连续中文子串是一个明确的负面诊断，不能记成通过。字节减少不等于 token、延迟或通用收益。

浏览器脚本需要本机 Playwright 和 Google Chrome。可通过 `VCM_PLAYWRIGHT_MODULE` 指定 Playwright ESM 入口的绝对路径；未设置时尝试当前用户的 Codex 缓存路径。Chrome 默认路径为macOS标准应用路径，因此这套浏览器脚本尚不是跨平台测试承诺。

```sh
node scripts/verify-viewer.mjs
node scripts/verify-editor.mjs
node scripts/verify-creation.mjs
node scripts/verify-knowledge-tools.mjs
node scripts/verify-viewer-races.mjs
node scripts/verify-simplification.mjs
```

命名的HTTP故障注入、浏览器内受控API Mock和真实端到端路径分别说明。历史macOS验收包含Viewer16/16、Editor14/14、创建8/8、导出7/7；不是Windows/Linux、新机器、Finder双击、Gatekeeper或实际个人安装发现的认证。

## 开发与贡献

技术栈：Node24原生HTTP/ESM、原生SQLite、原生JavaScript、Cytoscape。没有前端运行时框架、向量服务或新的HTTP框架。

应用调用链：浏览器 / Skill 客户端 → 本地 HTTP → Domain / Read / Graph Services → Store → SQLite。前端不复制Store或生命周期业务规则。

主要目录：

```text
SKILL.md                    Skill入口与授权边界
Install.command / .cmd      交互安装入口
scripts/setup.mjs           源码白名单安装、依赖与就绪检查
scripts/vcm.mjs             稳定路径的启动与doctor
src/db/                    Schema、migration、Store
src/domain/                策略与错误类型
src/services/              领域操作、检索、图谱和导出
src/server/                本地HTTP边界、Router、静态资源
src/client/                临时只读回复记忆采集器
viewer/                    三栏网页、Controller、State和组件
tests/                     分层回归与真实接口/安装测试
references/                领域、API和设计契约
```

开始修改前阅读相关领域文档。保持不可变Revision、服务端事务版本校验、Metric范围、草稿与异步请求身份保护。高风险操作必须使用真实dry-run预览并在执行时重新检查。

打包为源码白名单归档：

```sh
node scripts/package-skill.mjs /absolute/path/to/new-preview.zip
node scripts/package-skill.mjs /absolute/path/to/new-preview.tar.gz
```

ZIP打包需要系统 `zip` 命令；测试ZIP提取使用 `unzip`。归档拒绝覆盖已有文件，保留macOS安装入口的可执行权限。包不包含Node或已安装的npm依赖。正式升级、自动更新、云服务和独立公开介绍站仍不属于当前预览。

贡献前运行相应测试；测试数据明确标记DEMO。不要修改已发布历史migration；如需Schema变更，先说明原因并使用前向migration。发现安全问题时不要在公开Issue中贴数据库、凭据、私人来源或完整原文。

## 许可证与技术来源

MIT，见 [LICENSE](LICENSE)。再分发请保留许可与版权声明；依赖保留其各自许可。Cytoscape通过npm安装，不复制到源码白名单包。

设计参考了开源系统的可取模式，但未引入其整体框架或宣称实现同等能力：

- Claude-mem：先候选索引、再选中详情的渐进式读取；
- Graphiti：关系、来源及时间/版本边界的区分；
- MemPalace：项目范围和原始证据与派生断言的区分；
- Basic Memory：可读Markdown与结构化元数据；
- Mem0：检索和历史查看分离；
- LongMemEval：将检索评估与答案评估分开，不把命中等同答案正确。

固定commit源码、适配范围和未实现功能见 [开源技术核对](references/open-source-recall-patterns.md) 与 [Recall说明](references/recall-and-export.md)。这些是独立实现的设计借鉴，不是代码拷贝、第三方性能认证或“优于所有记忆系统”的声明。
