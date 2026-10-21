# Architecture & product boundary

## 本项目拥有的层

Launch State Engine 拥有“适用流程 + 状态 + 证据 + 解释”这一层：

1. 将 Product Context 与规则条件匹配，生成小而适用的 Flow。
2. 表达节点依赖、当前状态、blocker、next action、actor 与完成标准。
3. 保存 claim 和 evidence 的区别；状态变更与 evidence 提交都不等于 verified completion。
4. 让人和任意 Agent 通过同一份本地 Launch Truth 读写状态。
5. 把 Official Rules、Product Context、Field Experience 分开存放和解释。

## 明确不属于本项目

- 不生成、迁移、构建或检查小程序业务代码。
- 不替代 Coding Agent、WorkBuddy、CodeBuddy 或微信开发者工具。
- 不重做 CloudBase 部署、数据库、云函数或身份服务。
- 不重做 `mp-skills`、`ai-mode-skills` 的 Skill 生成、验证和评测。
- 不代替公众平台的实名认证、备案、扫码、审核与发布。
- 不建账号、团队、权限、云同步、Agent orchestration 或模型 API。

## 架构

```text
ProductContext ──> Rule Registry ──> Flow compiler ──> Applicable Flow ──┐
                        │                                                │
Node Catalog ───────────┘                       Launch Truth patch ──────┤
Official Sources / Field Experience（分离）                              ▼
                                                     Flow with status ──> next / parallel（依赖图派生）
                                                                     ├──> Dashboard（human）
                                                                     └──> launch-state CLI（agent）
```

Launch Truth 是本地文件：active case 存于 `public/flows/launch-state.json`，每个 Launch Case（`<productId>:wechat-launch`）持久化于 `public/flows/launch-cases/`。Dashboard 与 CLI 通过同一套 `lib/launch-store` 语义读写同一份 active truth。路径相对于 LSE 仓库根目录：dev API 使用 Vite 的项目根目录，CLI 依次使用 `--root`、`LSE_ROOT`、CLI 文件所在的 LSE 仓库，并校验目标是 LSE 仓库，不使用当前工作目录。每次读取都从 ProductContext 重新编译 Flow，再叠加该 case 的 patch；没有其他状态来源。

规则只负责适用性判断。节点模板保存工作要求与完成标准；Dashboard 不包含微信规则。`official` 规则可以包含节点，`field_experience` 规则仅追加 field note，不能自行创造 hard requirement。

## 写入通道与验证语义

| 通道 | 调用方 | 可写 | 不可写 |
|---|---|---|---|
| Human（Dashboard 状态选择，dev API `action: "status"`） | 人 | 任意状态，含 `completed`（记录在 `humanStatuses`） | — |
| Agent（CLI `submit` / `propose-*`，Dashboard WebMCP 工具，dev API `action: "propose"`） | 任意 Agent | `not_started` / `waiting` / `blocked` 提议、blocker、evidence | `completed`、`humanStatuses` |

- 两个 Agent 入口共用 `buildSubmitDelta` 校验：只接受已知节点，拒绝 `completed`，evidence 的 `verifiedBy` 一律由通道写为 `agent_submitted`（payload 中的声明会被覆盖）。
- Human 状态在 Agent 提议之后应用：Agent 提议不能覆盖人工确认。
- `completed` 是人工确认，不是机器验证。LSE 不运行、不检查用户的小程序工程，因此没有任何节点由机器派生完成；LSE 自身的 test / build 结果不是任何 Launch Case 的 evidence。
- 高风险节点的 exit criteria 应要求人工核验 evidence 后再确认完成。

这些是接口契约，不是安全边界。Launch Truth 是普通 JSON 文件，dev API（仅 `npm run dev` 时存在）不做认证；能直接写文件或调用 API 的进程可以绕过契约。

## 规则覆盖边界（coverage boundary）

- `ruleEvaluation.coverage` 随每个编译后的 Flow 输出，声明 Registry 覆盖的产品画像与边界。
- 「已确认某规则不适用」（excluded）与「Registry 尚未覆盖某类规则」（unverified coverage）是两种状态；未匹配到更多规则不等于没有更多要求。
- coverage 是 Registry 元数据（人工核实后更新），不是 case 状态；Agent 发现不能自动提升 coverage。
- coverage 的依据是所引用的微信官方文档与维护者的上线实践经验；它不声称任何产品已完成生产上线，也不是合规审计。

## Next 与并行推进

- Stage 顺序是认知分组，不代表执行顺序；执行先后只由节点 `dependencies` 决定。
- catalog 只记录有可靠依据的硬依赖；「未记录依赖」不等于官方确认可并行。
- `lib/flow-engine/parallel.ts` 是唯一的可开始判断：`startableNodes` 选出依赖全部完成、未完成且未阻塞的节点；`selectNextAction` 只从中（或从待确认的产品决策、依赖已满足的 blocker）选出 Next；`computeParallelGuidance` 用同一集合给出可同时推进的工作。CLI 与 Dashboard 都调用这些函数。
- 这些输出是纯派生，不改变状态，也不是排期。
