# State model

类型定义以 `lib/flow-engine/types.ts` 与 `lib/launch-store-types.ts` 为准；本文只说明语义。

## Flow（编译结果，每次读取重新生成）

```ts
type Flow = {
  schemaVersion: "1.1"
  flowId: string
  project: { name: string; caseId: string; target: string }
  productContext: ProductContext
  stages: { id; index; title; purpose; nodes: FlowNode[] }[]
  excludedCapabilities: FlowDecision[]      // 已确认不适用（附理由）
  undeterminedCapabilities: FlowDecision[]  // 因 unknown 尚未确定，owner = user
  ruleEvaluation: { registryVersion; generatedAt; matchedRuleIds; undeterminedRuleIds; coverage }
}
```

## Node

```ts
type FlowNode = {
  id: string
  stageId: string                 // 展示分组，不是执行顺序
  title: string
  dependencies: string[]          // 执行先后的唯一依据
  status: "completed" | "waiting" | "blocked" | "not_started"
  requirementKind: "external_requirement" | "conditional_requirement" | "product_decision" | "launch_process" | "experience_recommendation"
  applicability: { included: true; matchedRuleIds: string[]; why: string[]; requirementKind; triggeredBy: string[] }
  whyThisApplies: string
  requirement: string
  actorType: "AUTO" | "AI_OR_HUMAN" | "HUMAN"
  workProfile: { complexity: string; volume: string; risk: string }
  nextAction: string
  officialSources: Source[]
  fieldNotes: string[]            // 经验建议，非官方要求
  evidence: Evidence[]            // { type, label, value, verifiedBy }
  exitCriteria: string[]
  blocker: { summary: string; diagnosis: string; resolution: string } | null
}
```

## Launch Truth（持久化状态）

- **Launch Case**（`<productId>:wechat-launch`）是一等对象，各自持有 ProductContext 与 patch。active case 存于 `public/flows/launch-state.json`，每个 case 的持久副本存于 `public/flows/launch-cases/`。
- 首次运行时没有任何 case；Dashboard 显示空状态，CLI 提示先 `case-create`。
- `caseOrigin`：`created`（由用户创建）、`fixture`（用虚构示例产品创建）、`runtime`（早期版本遗留的 active truth）。
- patch 有两个通道：
  - `nodePatches`：Agent 提议（status 仅 `not_started` / `waiting` / `blocked`）、blocker 与 `agent_submitted` evidence；
  - `humanStatuses`：Human 在 Dashboard 中确认的状态，可为 `completed`，最后应用。
- 节点状态 = 编译后的初始状态（`not_started`）+ Agent 提议 + Human 确认。没有任何节点由 LSE 自身的 build / test 或其他机器检查派生。
- `ruleEvaluation.coverage` 是 Registry 元数据，不是 case 状态。Product Unknown（可询问用户解决）与 Rule Coverage Unknown（Registry 尚未覆盖的规则族）必须区分。
- Next 与 Parallel guidance（`lib/flow-engine/parallel.ts`）是纯派生输出，不是状态。

## 状态定义

- `not_started`：适用，但尚未开始。
- `waiting`：正在推进或等待外部结果；当前没有已知硬阻塞。
- `blocked`：存在明确 blocker，必须附 diagnosis 和 resolution。
- `completed`：由 Human 确认 exit criteria 已满足。这是人工确认，不是机器验证；高风险节点应先核对 evidence。

“不适用”不作为运行状态。它属于 applicability 计算结果，并由 `excludedCapabilities` 保留解释。
