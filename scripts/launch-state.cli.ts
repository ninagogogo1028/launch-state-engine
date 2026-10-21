#!/usr/bin/env -S node --experimental-strip-types
import path from "node:path";
import {
  applyStorePatch,
  buildFlowFromStore,
  buildSubmitDelta,
  emptyStore,
  resetStorePatch,
  sanitizeStore,
  updateStoreContext,
} from "../lib/launch-store.ts";
import { DEPENDENCY_BASIS, computeParallelGuidance, selectNextAction, unmetDependencies } from "../lib/flow-engine/parallel.ts";
import { FIXTURES } from "../lib/flow-engine/fixtures.ts";
import { normalizeProductContext } from "../lib/flow-engine/compiler.ts";
import type { Blocker, Flow, ProductContext } from "../lib/flow-engine/types.ts";
import type { LaunchStateStore } from "../lib/launch-store-types.ts";
import {
  CaseExistsError,
  CaseNotFoundError,
  NoActiveCaseError,
  assertContextUpdateAllowed,
  caseFilePath,
  createLaunchCase,
  listLaunchCases,
  loadActiveStore,
  readJson,
  requireActiveStore,
  saveStore,
  switchLaunchCase,
} from "../lib/launch-store-file.ts";

const helpText = `LSE · Launch State Engine CLI

最小 external agent interface。与 Dashboard 共享同一份 active Launch Truth。

Launch Case 是一等对象：一个 case = 一个 Product 的一个 launch target，
id 形如 <productId>:wechat-launch。每个 case 独立持有 ProductContext、agent patch
与 humanStatuses；切换 case 后互不可见。
active case：public/flows/launch-state.json（CLI 与 Dashboard 共用）
case 存储：public/flows/launch-cases/<caseId>.json
首次运行时没有任何 case：先用 case-create 创建（或在 Dashboard 中「添加我的产品」）。
Dashboard（npm run dev）读写同一份 active truth：人工状态（含 completed）记录在
humanStatuses 通道；agent 的一切提交永远是 proposal。

用法：
  npm run launch-state -- <command> [args]
  （或 npx --no-install launch-state <command> [args]）

开始你自己的 Launch Case：
  1. cp examples/product-context.json my-product.json   # 改 productId / name 与产品事实；不确定就保留 "unknown"
  2. npm run launch-state -- case-create my-product.json
  3. npm run dev                                         # Dashboard 显示的就是这个 active case

Launch Case 命令：
  cases [--pretty]            列出全部 Launch Cases（标记 active）
  case [caseId] [--pretty]    查看当前（或指定）case 概览：origin、updatedAt、summary、patch 概况
  case-create <jsonFile> | case-create --from-fixture <name> [--no-switch]
                              以一个 ProductContext 创建新 Launch Case 并切换为 active。
                              --from-fixture 使用虚构示例产品（minimal / productivity / ugc）。
                              同一 productId 已存在时拒绝（提示 case-switch）。--no-switch 只创建不切换。
  case-switch <caseId>        切换 active case；切换前先把当前 case 持久化。

当前 case 命令（对 active case 生效）：
  help                        本帮助
  status [--pretty]           打印 { productContext, caseOrigin, summary, coverage, nextAction }
  next [--pretty]             下一步。只从「已记录依赖全部完成」的节点中选择，与 parallel 同一来源。
                              product_decision 类返回结构化 handoff 契约
                              （requiresUserDecision / policy:"stop_and_ask" / mayContinue / resume）
  parallel [--pretty]         当前可开始的工作、可同时推进的机会、等待中的 blocker、
                              尚不能开始的工作与缺失依赖。依据是已记录的依赖图；Stage 顺序是认知
                              分组不是执行顺序。「无已知硬依赖」不等于官方确认可并行。
  context [--pretty]          打印当前 ProductContext（含 unknown 字段）
  flow [--pretty]             打印完整 Flow JSON（含 stages、excluded、undetermined、patch）
  node <nodeId> [--pretty]    节点详情：requirement、actorType、requirementKind、why、dependencies、
                              exitCriteria、sources、evidence、blocker、status
  undetermined [--pretty]     所有待确认产品决策清单（每条 owner:"user"、requiresUserDecision:true，
                              明确是 user decides，agent 不能替）
  excluded [--pretty]         已确认不适用的条件节点与理由
  submit <payload.json>       提交一条或多条节点 patch（evidence / blocker / status）。输入是 JSON 文件：
                                { nodePatches: { [nodeId]: { status?, blocker? (summary/diagnosis/resolution | null), evidence?: [{type,label,value}] } } }
                                · status 仅允许 not_started / waiting / blocked。永远不可提交 completed。
                                · evidence 会追加，并一律标 verifiedBy="agent_submitted"。
  propose-status <nodeId> <not_started|waiting|blocked> [reason]
                              简版：直接 propose 一个节点状态（不可 completed）。
  propose-blocker <nodeId> <summary> <diagnosis> <resolution>
                              简版：直接报告一个 blocker。
  propose-evidence <nodeId> <type> <label> <value>
                              简版：直接追加一条 evidence（verifiedBy=agent_submitted，非 completion）。
  context-set <jsonFile> | context-set --from-fixture <name>
                              更新当前 case 的 ProductContext 事实。仅限与当前 case 相同的 productId；
                              不同产品会被拒绝（请用 case-create / case-switch）。注意：
                                · 属于 user 的 product_decision 类字段，agent 不应随意覆盖（建议通过 undetermined 提示用户）。
                                · 未知字段 / null 值会被拒绝。
  reset [--fixture <name>]    清空当前 case 的 patch（保留 ProductContext 与 case 身份）。
                              --fixture 仅接受与当前 case 相同 productId 的 fixture；换产品请用 case-create。

写入边界（由本 CLI 与 Agent-facing 接口契约执行）：
  · Agent-facing 命令永远不能把任何节点写成 completed，也不能写 humanStatuses。
  · completed 只能由 Human 在 Dashboard 中确认；它是人工确认，不是机器验证。
  · LSE 不运行、不检查你的小程序工程：没有任何节点会因 LSE 自身的 build/test 而完成。
  · 提交的 evidence 一律标 agent_submitted；evidence submission ≠ verified completion。
  · unknown 被保留为三态合法值，绝不被静默转为 false（缺失的 context 字段同样按 unknown 处理）。
  · 不同 Product 的 patch / humanStatuses 永不串流：context-set 跨产品直接拒绝。
  · 这些是接口契约，不是安全边界：Launch Truth 是普通本地 JSON 文件，dev API 不做认证；
    能直接改文件或调用 dev API 的进程可以绕过它们。

规则信任边界（provenance discipline）：
  · 只有 LSE Rule Registry 的 official rule 才是 authoritative requirement；field experience 只追加建议。
  · agent 自行发现、尚未进入 Registry 的平台约束属于 unverified / agent-discovered 信息：
    只能作为 evidence（verifiedBy=agent_submitted）提交到相关节点，或如实提示用户；
    不得冒充 LSE official requirement，也不得改变 Applicable Flow。
  · Registry 的 coverage 状态随 flow 输出（status/flow 的 coverage 字段）：level=partial 表示
    只覆盖已验证的产品画像；「未匹配到更多规则」不等于「没有更多要求」，Flow 不是完整的
    微信上线清单。excluded（已确认不适用）与 unverified coverage（尚未覆盖）是两种状态。
`;

const FIXTURE_CASE_NOTE = "This case was created from a fictional example fixture, not from your product's facts.";

function rootDir() {
  return process.cwd();
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function render(pretty: boolean, data: unknown) {
  const out = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  process.stdout.write(out + "\n");
}

function fail(msg: string): never {
  process.stderr.write("ERROR: " + msg + "\n");
  process.exit(2);
}

type ParsedArgs = { cmd: string; positional: string[]; flags: Record<string, string | boolean> };

// Flags whose value may be written as a separate token (`--fixture productivity`),
// matching the syntax documented in the help text. All other flags are boolean.
const VALUE_FLAGS = new Set(["fixture", "from-fixture"]);

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  // Only the first bare token is the command; every later one is positional.
  let cmd: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const eq = token.indexOf("=");
      if (eq >= 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else if (VALUE_FLAGS.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[name] = argv[++i];
      } else {
        flags[name] = true;
      }
    } else if (cmd === null) {
      cmd = token;
    } else {
      positional.push(token);
    }
  }
  return { cmd: cmd ?? "status", positional, flags };
}

function flowNodes(flow: Flow) {
  return flow.stages.flatMap(s => s.nodes);
}

function unknownFields(context: ProductContext): string[] {
  // Report the same compatibility projection the compiler evaluates. This
  // keeps older contexts honest without asking users to reconfirm facts that
  // legacy `payment` already establishes (for example payment:none).
  const normalized = normalizeProductContext(context);
  const fields = Object.entries(normalized).filter(([, value]) => value === "unknown").map(([key]) => key);
  if (context.externalProcessing === undefined) fields.push("externalProcessing");
  return fields;
}

function caseInfo(store: LaunchStateStore) {
  return {
    caseOrigin: store.caseOrigin ?? null,
    ...(store.caseOrigin === "fixture" ? { exampleCase: FIXTURE_CASE_NOTE } : {}),
  };
}

// The single next-action contract shared by `next` and `status`. Eligibility
// comes from lib/flow-engine/parallel.ts (the same source the dashboard and
// `parallel` use): a node is only offered once its recorded dependencies are
// completed.
function describeNext(flow: Flow) {
  const next = selectNextAction(flow);
  if (next.kind === "product_decision") {
    const decision = next.decision;
    // Structured human-decision handoff contract: the data layer already
    // prevents an agent from deciding; these fields tell it when to stop,
    // that pending-decision work may continue, and how to resume.
    return {
      kind: "product_decision",
      owner: "user",
      requiresUserDecision: true,
      policy: "stop_and_ask",
      nodeId: decision.nodeId,
      prompt: decision.decision?.prompt ?? decision.title,
      fields: decision.decision?.fields ?? [],
      impact: decision.decision?.impact,
      mayContinue: {
        existingFlowNodes: true,
        note: "Undetermined capabilities are not part of the compiled flow; startable nodes (see `launch-state parallel`) may continue. Never decide for the user and never set unknown to false.",
      },
      resume: "After the user answers, update facts with `launch-state context-set <json>` (or the dashboard), then re-run `launch-state next` — the flow recompiles from the updated facts.",
      rule: "Agent MUST ask the user. Agent MUST NOT silently set unknown to false.",
    };
  }
  if (next.kind === "blocker") {
    const node = next.node;
    return { kind: "blocker", nodeId: node.id, blocker: node.blocker, title: node.title, actorType: node.actorType, requirementKind: node.requirementKind, basis: DEPENDENCY_BASIS };
  }
  if (next.kind === "done") {
    return {
      kind: "done",
      note: "Every node in this compiled flow is completed (human-confirmed). Rule coverage is partial: this flow is not a complete WeChat launch checklist.",
    };
  }
  if (next.kind === "no_startable_node") {
    return {
      kind: "no_startable_node",
      note: "No incomplete node has all recorded dependencies completed. Resolve the waiting blockers listed by `launch-state parallel`.",
    };
  }
  const node = next.node;
  return {
    kind: node.actorType === "HUMAN" ? "user_action" : node.actorType === "AUTO" ? "agent_action" : "ai_or_human_action",
    nodeId: node.id,
    title: node.title,
    actorType: node.actorType,
    requirementKind: node.requirementKind,
    nextAction: node.nextAction,
    basis: DEPENDENCY_BASIS,
    guidance: node.actorType === "HUMAN"
      ? "This node requires a human (WeChat admin / platform action). Agent must hand off to the user."
      : "Agent may work on this node and submit evidence via submit/propose-evidence. Agent must not mark it completed; completion is confirmed by the human in the dashboard.",
  };
}

function summarizeFlow(store: LaunchStateStore, flow: Flow) {
  const nodes = flowNodes(flow);
  return {
    storeUpdatedAt: store.updatedAt,
    productContext: { id: store.contextId, name: store.productContext.name, unknownFields: unknownFields(store.productContext) },
    ...caseInfo(store),
    summary: {
      nodeCount: nodes.length,
      completed: nodes.filter(n => n.status === "completed").length,
      stages: flow.stages.length,
      excludedCount: flow.excludedCapabilities.length,
      undeterminedCount: flow.undeterminedCapabilities.length,
    },
    coverage: flow.ruleEvaluation.coverage,
    nextAction: describeNext(flow),
  };
}

function nodeDetail(flow: Flow, nodeId: string) {
  const node = flowNodes(flow).find(n => n.id === nodeId);
  if (!node) {
    const und = flow.undeterminedCapabilities.find(x => x.nodeId === nodeId);
    if (und) {
      return {
        location: "undetermined",
        outcome: und.outcome,
        title: und.title,
        requirementKind: und.requirementKind,
        why: und.why,
        owner: "user",
        requiresUserDecision: true,
        decision: und.decision ? { owner: und.decision.owner, fields: und.decision.fields, prompt: und.decision.prompt, impact: und.decision.impact } : null,
      };
    }
    const exc = flow.excludedCapabilities.find(x => x.nodeId === nodeId);
    if (exc) {
      return { location: "excluded", outcome: exc.outcome, title: exc.title, requirementKind: exc.requirementKind, why: exc.why };
    }
    return null;
  }
  const app = typeof node.applicability === "string" ? null : node.applicability;
  return {
    location: "flow",
    id: node.id,
    stageId: node.stageId,
    title: node.title,
    status: node.status,
    requirementKind: node.requirementKind,
    actorType: node.actorType,
    nextAction: node.nextAction,
    applicability: app ? {
      included: app.included,
      matchedRuleIds: app.matchedRuleIds,
      why: app.why,
      triggeredBy: app.triggeredBy,
      requirementKind: app.requirementKind,
    } : node.applicability,
    whyThisApplies: node.whyThisApplies,
    requirement: node.requirement,
    dependencies: node.dependencies,
    unmetDependencies: unmetDependencies(flow, node),
    exitCriteria: node.exitCriteria,
    officialSources: node.officialSources.map(s => ({ id: s.id, title: s.title, url: s.url, publisher: s.publisher })),
    fieldNotes: node.fieldNotes,
    evidence: node.evidence,
    blocker: node.blocker,
    workProfile: node.workProfile,
    execution: {
      whoActs: node.actorType === "HUMAN" ? "USER (human must perform; e.g. WeChat platform login/scan/admin)" :
        node.actorType === "AUTO" ? "AGENT (or automation)" :
        "AGENT_OR_HUMAN",
      agentMayWriteStatus: "only propose not_started/waiting/blocked; never completed",
      agentMaySubmitEvidence: true,
      agentMayMarkCompleted: false,
      completedBy: "human confirmation in the dashboard",
    },
  };
}

// Every agent-facing write goes through buildSubmitDelta: known nodes only,
// completed never accepted, evidence attributed to agent_submitted.
async function submitProposal(root: string, payload: unknown) {
  const store = await requireActiveStore(root);
  const outcome = buildSubmitDelta(store.productContext, payload);
  if (!outcome.delta.nodePatches) fail(`submit rejected: ${outcome.rejected.join("; ") || "no valid patches"}`);
  const next = await saveStore(applyStorePatch(store, outcome.delta), root);
  return { store: next, flow: buildFlowFromStore(next), accepted: outcome.accepted, rejected: outcome.rejected };
}

async function readContextArg(root: string, cmd: string, flags: ParsedArgs["flags"], positional: string[]): Promise<ProductContext> {
  const from = flags["from-fixture"];
  if (typeof from === "string") {
    const fixture = FIXTURES[from];
    if (!fixture) fail(`fixture not found. available: ${Object.keys(FIXTURES).join(", ")}`);
    return { ...fixture };
  }
  const file = positional[0];
  if (!file) fail(`${cmd} requires <jsonFile> (a ProductContext) or --from-fixture <name>`);
  try {
    return await readJson<ProductContext>(path.isAbsolute(file) ? file : path.join(root, file));
  } catch (err) {
    fail(`${cmd}: cannot read ProductContext file ${file} (${errorMessage(err)})`);
  }
}

async function run() {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
  const root = rootDir();
  if (cmd === "help" || flags.h || flags.help) {
    process.stdout.write(helpText + "\n");
    return;
  }
  const pretty = Boolean(flags.pretty);

  if (cmd === "context") {
    const store = await requireActiveStore(root);
    render(pretty, { schemaVersion: store.schemaVersion, contextId: store.contextId, updatedAt: store.updatedAt, productContext: store.productContext, unknownFields: unknownFields(store.productContext) });
    return;
  }

  if (cmd === "status") {
    const store = await requireActiveStore(root);
    render(pretty, summarizeFlow(store, buildFlowFromStore(store)));
    return;
  }

  if (cmd === "flow") {
    const store = await requireActiveStore(root);
    render(pretty, { store: { schemaVersion: store.schemaVersion, contextId: store.contextId, updatedAt: store.updatedAt, caseOrigin: store.caseOrigin ?? null, patch: store.patch }, flow: buildFlowFromStore(store) });
    return;
  }

  if (cmd === "next") {
    const store = await requireActiveStore(root);
    render(pretty, { caseId: store.contextId, ...caseInfo(store), next: describeNext(buildFlowFromStore(store)) });
    return;
  }

  if (cmd === "parallel") {
    const store = await requireActiveStore(root);
    render(pretty, { caseId: store.contextId, guidance: computeParallelGuidance(buildFlowFromStore(store)) });
    return;
  }

  if (cmd === "node") {
    const nodeId = positional[0];
    if (!nodeId) fail("node requires <nodeId>");
    const store = await requireActiveStore(root);
    const detail = nodeDetail(buildFlowFromStore(store), nodeId);
    if (!detail) fail(`unknown nodeId: ${nodeId}`);
    render(pretty, detail);
    return;
  }

  if (cmd === "undetermined") {
    const store = await requireActiveStore(root);
    const flow = buildFlowFromStore(store);
    render(pretty, {
      count: flow.undeterminedCapabilities.length,
      policy: "stop_and_ask",
      resume: "After the user answers, update facts with `launch-state context-set <json>` (or the dashboard), then re-run `launch-state next`.",
      items: flow.undeterminedCapabilities.map(x => ({
        nodeId: x.nodeId,
        title: x.title,
        requirementKind: x.requirementKind,
        owner: "user",
        requiresUserDecision: true,
        decision: x.decision ? { OWNER: x.decision.owner, fields: x.decision.fields, prompt: x.decision.prompt, impact: x.decision.impact, NOTE: "Owner is USER. Agent MUST ask; never auto-resolve unknown to false." } : null,
        why: x.why,
        matchedRuleIds: x.matchedRuleIds,
      })),
    });
    return;
  }

  if (cmd === "excluded") {
    const store = await requireActiveStore(root);
    const flow = buildFlowFromStore(store);
    render(pretty, { count: flow.excludedCapabilities.length, items: flow.excludedCapabilities });
    return;
  }

  if (cmd === "submit") {
    const file = positional[0];
    if (!file) fail("submit requires <payload.json>");
    let payload: unknown;
    try {
      payload = await readJson(path.isAbsolute(file) ? file : path.join(root, file));
    } catch (err) {
      fail(`submit: cannot read payload ${file} (${errorMessage(err)})`);
    }
    const result = await submitProposal(root, payload);
    render(pretty, { accepted: true, rejected: result.rejected, patched: result.accepted, newSummary: summarizeFlow(result.store, result.flow) });
    return;
  }

  if (cmd === "propose-status") {
    const [nodeId, status] = positional;
    if (!nodeId || !status) fail("propose-status requires <nodeId> <not_started|waiting|blocked>");
    if (status === "completed") fail("propose-status: completed is NEVER allowed via this CLI. Completion is confirmed by the human in the dashboard.");
    const result = await submitProposal(root, { nodePatches: { [nodeId]: { status } } });
    render(pretty, { accepted: true, nodeId, proposedStatus: status, note: "Status is a proposal/claim only; never implies completion.", newSummary: summarizeFlow(result.store, result.flow) });
    return;
  }

  if (cmd === "propose-blocker") {
    const [nodeId, summary, diagnosis, resolution] = positional;
    if (!nodeId || !summary || !diagnosis || !resolution) fail("propose-blocker requires <nodeId> <summary> <diagnosis> <resolution>");
    const blocker: Blocker = { summary, diagnosis, resolution };
    const result = await submitProposal(root, {
      nodePatches: { [nodeId]: { status: "blocked", blocker, evidence: [{ type: "blocker_report", label: "Blocker reported by agent", value: `${summary} | ${diagnosis}` }] } },
    });
    render(pretty, { accepted: true, nodeId, blocker, newSummary: summarizeFlow(result.store, result.flow) });
    return;
  }

  if (cmd === "propose-evidence") {
    const [nodeId, type, label, value] = positional;
    if (!nodeId || !type || !label || value === undefined) fail("propose-evidence requires <nodeId> <type> <label> <value>");
    const result = await submitProposal(root, { nodePatches: { [nodeId]: { evidence: [{ type, label, value }] } } });
    const nodeNow = flowNodes(result.flow).find(n => n.id === nodeId);
    render(pretty, {
      accepted: true,
      nodeId,
      evidenceAppended: nodeNow?.evidence.at(-1),
      note: "This is agent-submitted evidence. Completion status is unchanged.",
      currentStatus: nodeNow?.status,
      isCompleted: nodeNow?.status === "completed",
      newSummary: summarizeFlow(result.store, result.flow),
    });
    return;
  }

  if (cmd === "recompute") {
    fail("recompute was removed: no node is derived from LSE's own build/test any more, and every command recompiles the flow on read. Use `launch-state status`.");
  }

  if (cmd === "context-set") {
    const next = await readContextArg(root, cmd, flags, positional);
    const store = await requireActiveStore(root);
    try {
      assertContextUpdateAllowed(store, next);
    } catch (err) {
      fail(errorMessage(err));
    }
    const after = await saveStore(updateStoreContext(store, next), root);
    render(pretty, { accepted: true, contextId: after.contextId, productName: after.productContext.name, note: "ProductContext replaced. Agent: do NOT overwrite product_decision fields on behalf of user.", newSummary: summarizeFlow(after, buildFlowFromStore(after)) });
    return;
  }

  if (cmd === "reset") {
    // Fresh state for the SAME launch case: ProductContext and case identity
    // are preserved; only agent/human patches are cleared. Switching products
    // is deliberately not possible here — use case-create / case-switch.
    const store = await requireActiveStore(root);
    let next = resetStorePatch(store);
    const fixtureName = typeof flags.fixture === "string" ? flags.fixture : null;
    if (fixtureName) {
      const base = FIXTURES[fixtureName];
      if (!base) fail(`fixture not found. available: ${Object.keys(FIXTURES).join(", ")}`);
      if (base.productId !== store.productContext.productId) {
        fail(`fixture "${fixtureName}" is product "${base.productId}" but active case is "${store.contextId}" (${store.productContext.productId}). Use case-create / case-switch for a different product.`);
      }
      next = { ...emptyStore({ ...base }), ...(store.caseOrigin ? { caseOrigin: store.caseOrigin } : {}) };
    }
    await saveStore(next, root);
    render(pretty, { reset: true, caseId: next.contextId, clearedPatch: true, preservedContext: next.productContext.productId });
    return;
  }

  if (cmd === "cases") {
    render(pretty, await listLaunchCases(root));
    return;
  }

  if (cmd === "case") {
    const caseId = positional[0];
    const active = await loadActiveStore(root);
    let store: LaunchStateStore | null = active;
    if (caseId) {
      try {
        store = sanitizeStore(await readJson(caseFilePath(caseId, root)));
      } catch (err) {
        fail(`case not found or unreadable: ${caseId} (${errorMessage(err)})`);
      }
    }
    if (!store) throw new NoActiveCaseError();
    render(pretty, {
      caseId: store.contextId,
      active: store.contextId === active?.contextId,
      productId: store.productContext.productId,
      productName: store.productContext.name,
      origin: store.caseOrigin ?? null,
      updatedAt: store.updatedAt,
      patch: {
        proposalNodes: Object.keys({ ...store.patch.statuses, ...store.patch.nodePatches }).length,
        humanStatuses: Object.keys(store.patch.humanStatuses ?? {}).length,
      },
      summary: summarizeFlow(store, buildFlowFromStore(store)),
    });
    return;
  }

  if (cmd === "case-create") {
    const next = await readContextArg(root, cmd, flags, positional);
    const noSwitch = Boolean(flags["no-switch"]);
    let created: LaunchStateStore;
    try {
      created = await createLaunchCase(next, root, { switchTo: !noSwitch, origin: typeof flags["from-fixture"] === "string" ? "fixture" : "created" });
    } catch (err) {
      fail(err instanceof CaseExistsError ? err.message : `case-create: ${errorMessage(err)}`);
    }
    const caseId = created.contextId;
    render(pretty, { created: true, caseId, switched: !noSwitch, productId: next.productId, productName: next.name, hint: noSwitch ? `activate with: launch-state case-switch ${caseId}` : "Open the dashboard (npm run dev) to continue with this case." });
    return;
  }

  if (cmd === "case-switch") {
    const caseId = positional[0];
    if (!caseId) fail("case-switch requires <caseId> (see: launch-state cases)");
    let result: Awaited<ReturnType<typeof switchLaunchCase>>;
    try {
      result = await switchLaunchCase(caseId, root);
    } catch (err) {
      fail(err instanceof CaseNotFoundError ? err.message : errorMessage(err));
    }
    if (!result.switched) {
      render(pretty, { switched: false, activeCaseId: caseId, note: "already active" });
      return;
    }
    render(pretty, { switched: true, from: result.from, to: result.to.contextId, summary: summarizeFlow(result.to, buildFlowFromStore(result.to)) });
    return;
  }

  fail(`unknown command: ${cmd}. Use launch-state help.`);
}

run().catch(err => {
  if (err instanceof NoActiveCaseError) fail(err.message);
  console.error("Unhandled CLI error:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
