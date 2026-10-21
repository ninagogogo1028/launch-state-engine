import test from "node:test";
import assert from "node:assert/strict";
import {
  applyHumanStatuses,
  applyPatchToFlow,
  applyStorePatch,
  buildFlowFromStore,
  buildSubmitDelta,
  emptyStore,
  sanitizePatch,
  sanitizeStore,
} from "../lib/launch-store.ts";
import { validateContextForWrite } from "../lib/launch-store-file.ts";
import { compileFlow } from "../lib/flow-engine/compiler.ts";
import { computeParallelGuidance, selectNextAction, startableNodes } from "../lib/flow-engine/parallel.ts";
import type { Flow } from "../lib/flow-engine/types.ts";
import { FIXTURES } from "../lib/flow-engine/fixtures.ts";
import type { ProductContext } from "../lib/flow-engine/types.ts";

const CONTEXT: ProductContext = FIXTURES.productivity;
const baseFlow = () => compileFlow(CONTEXT);
const nodeStatus = (flow: ReturnType<typeof baseFlow>, nodeId: string) =>
  flow.stages.flatMap(s => s.nodes).find(n => n.id === nodeId)?.status;
const WRITABLE_NODE = "migration-core-path";

test("agent submit channel never accepts completed", () => {
  const { delta, rejected } = buildSubmitDelta(CONTEXT, { nodePatches: { [WRITABLE_NODE]: { status: "completed" } } });
  assert.deepEqual(rejected, [`${WRITABLE_NODE}:completed_not_allowed`]);
  assert.deepEqual(delta.nodePatches, undefined);
  const patched = applyPatchToFlow(baseFlow(), { nodePatches: { [WRITABLE_NODE]: { status: "completed" } } });
  assert.equal(nodeStatus(patched, WRITABLE_NODE), "not_started");
});

test("agent submit channel rejects unknown node ids", () => {
  const { delta, rejected } = buildSubmitDelta(CONTEXT, { nodePatches: { "no-such-node": { status: "waiting" } } });
  assert.deepEqual(rejected, ["no-such-node:unknown_node"]);
  assert.deepEqual(delta.nodePatches, undefined);
});

test("ready-preflight is an ordinary node: agents may propose, never complete", () => {
  const { delta, rejected } = buildSubmitDelta(CONTEXT, { nodePatches: { "ready-preflight": { status: "waiting" } } });
  assert.deepEqual(rejected, []);
  assert.equal(nodeStatus(applyPatchToFlow(baseFlow(), delta), "ready-preflight"), "waiting");
  const refused = buildSubmitDelta(CONTEXT, { nodePatches: { "ready-preflight": { status: "completed" } } });
  assert.deepEqual(refused.rejected, ["ready-preflight:completed_not_allowed"]);
});

test("agent-submitted evidence cannot claim human verification", () => {
  const patched = applyPatchToFlow(baseFlow(), {
    nodePatches: { [WRITABLE_NODE]: { evidence: [{ type: "build_log", label: "Build passed", value: "exit 0", verifiedBy: "human" }] } },
  });
  const node = patched.stages.flatMap(s => s.nodes).find(n => n.id === WRITABLE_NODE)!;
  assert.equal(node.evidence.at(-1)?.verifiedBy, "agent_submitted");
});

test("evidence submission is a claim, not verified completion", () => {
  const { flow } = (() => {
    const patched = applyPatchToFlow(baseFlow(), {
      nodePatches: { [WRITABLE_NODE]: { evidence: [{ type: "build_log", label: "Build passed", value: "exit 0" }] } },
    });
    return { flow: patched };
  })();
  assert.equal(nodeStatus(flow, WRITABLE_NODE), "not_started");
  const node = flow.stages.flatMap(s => s.nodes).find(n => n.id === WRITABLE_NODE)!;
  assert.equal(node.evidence.length, 1);
});

test("human channel can record verified completion and outranks agent proposals", () => {
  const store = applyHumanStatuses(emptyStore(CONTEXT), { [WRITABLE_NODE]: "completed" });
  assert.equal(store.patch.humanStatuses?.[WRITABLE_NODE], "completed");
  const agentProposal = applyStorePatch(store, { nodePatches: { [WRITABLE_NODE]: { status: "waiting" } } });
  const flow = applyPatchToFlow(baseFlow(), agentProposal.patch);
  assert.equal(nodeStatus(flow, WRITABLE_NODE), "completed");
});

test("ready-preflight never completes from anything but a human confirmation", () => {
  // Every other node human-completed and a green LSE-shaped evidence bundle
  // supplied as agent evidence: ready-preflight must still not be completed.
  const others = Object.fromEntries(baseFlow().stages.flatMap(s => s.nodes).filter(n => n.id !== "ready-preflight").map(n => [n.id, "completed"]));
  let store = applyHumanStatuses(emptyStore(CONTEXT), others);
  const { delta } = buildSubmitDelta(CONTEXT, { nodePatches: { "ready-preflight": { evidence: [{ type: "ready-preflight-bundle", label: "LSE build passed", value: "exit 0", verifiedBy: "machine" }] } } });
  store = applyStorePatch(store, delta);
  const flow = buildFlowFromStore(store);
  const node = flow.stages.flatMap(s => s.nodes).find(n => n.id === "ready-preflight")!;
  assert.equal(node.status, "not_started");
  assert.equal(node.evidence.at(-1)?.verifiedBy, "agent_submitted");
  // Only the human channel completes it.
  const confirmed = buildFlowFromStore(applyHumanStatuses(store, { "ready-preflight": "completed" }));
  assert.equal(nodeStatus(confirmed, "ready-preflight"), "completed");
});

test("agent channel output never contains humanStatuses", () => {
  const sanitized = sanitizePatch({ humanStatuses: { [WRITABLE_NODE]: "completed" }, statuses: { [WRITABLE_NODE]: "waiting" } });
  assert.equal(sanitized.humanStatuses, undefined);
  const { delta, rejected } = buildSubmitDelta(CONTEXT, { nodePatches: { [WRITABLE_NODE]: { status: "waiting" } }, humanStatuses: { [WRITABLE_NODE]: "completed" } });
  assert.equal(delta.humanStatuses, undefined);
  assert.ok(rejected.includes("humanStatuses:human_channel_not_writable_by_agents"));
});

test("humanStatuses survive sanitizeStore round-trip", () => {
  const store = applyHumanStatuses(emptyStore(CONTEXT), { [WRITABLE_NODE]: "completed" });
  const roundTrip = sanitizeStore(JSON.parse(JSON.stringify(store)));
  assert.equal(roundTrip.patch.humanStatuses?.[WRITABLE_NODE], "completed");
});

test("human can also revert a completion to waiting", () => {
  const store = applyHumanStatuses(emptyStore(CONTEXT), { [WRITABLE_NODE]: "completed" });
  const reverted = applyHumanStatuses(store, { [WRITABLE_NODE]: "waiting" });
  const flow = applyPatchToFlow(baseFlow(), reverted.patch);
  assert.equal(nodeStatus(flow, WRITABLE_NODE), "waiting");
});

test("product decision unknown is never silently completed or falsified by write channels", () => {
  const withUnknown: ProductContext = { ...CONTEXT, hasUserAccounts: "unknown" };
  validateContextForWrite(withUnknown);
  const flow = applyPatchToFlow(compileFlow(withUnknown), {});
  assert.equal(flow.undeterminedCapabilities.length > 0, true);
  assert.equal(nodeStatus(flow, "ready-preflight"), "not_started");
});

test("context writes reject null tri-state values and unknown extra fields", () => {
  assert.throws(() => validateContextForWrite({ ...CONTEXT, imageUpload: null as unknown as boolean }));
  assert.throws(() => validateContextForWrite({ ...CONTEXT, hackerField: true } as unknown as ProductContext));
  assert.throws(() => validateContextForWrite({ ...CONTEXT, schemaVersion: "1.0" as unknown as "1.1" }));
});

test("legacy stores with contextId 'active' self-heal to a derived case id", () => {
  const legacy = { schemaVersion: "launch-state-store@1", contextId: "active", updatedAt: "2026-10-10T00:00:00.000Z", productContext: CONTEXT, patch: {} };
  const healed = sanitizeStore(legacy);
  assert.equal(healed.contextId, "example-productivity-app:wechat-launch");
});

test("case id mismatch between contextId and productContext fails loudly", () => {
  const conflicting = { schemaVersion: "launch-state-store@1", contextId: "other-product:wechat-launch", updatedAt: "2026-10-10T00:00:00.000Z", productContext: CONTEXT, patch: {} };
  assert.throws(() => sanitizeStore(conflicting), /case id mismatch/);
});

test("missing externalProcessing is undetermined, never silently false", () => {
  const withoutField = { ...CONTEXT, hasUserAccounts: false, files: false, imageUpload: false, clipboard: false, location: false } as ProductContext;
  delete (withoutField as Partial<ProductContext>).externalProcessing;
  const flow = compileFlow(withoutField);
  assert.equal(flow.undeterminedCapabilities.some(c => c.nodeId === "privacy-declaration"), true);
});

test("externalProcessing=true applies the privacy path even without cloud persistence", () => {
  const localFirstExternalAI: ProductContext = { ...CONTEXT, hasUserAccounts: false, files: false, imageUpload: false, clipboard: false, location: false, cloudData: false, externalProcessing: true };
  const flow = compileFlow(localFirstExternalAI);
  const nodeIds = flow.stages.flatMap(s => s.nodes.map(n => n.id));
  assert.equal(nodeIds.includes("privacy-declaration"), true);
  assert.equal(nodeIds.includes("backend-production"), false);
});

test("externalProcessing=false with no other privacy-relevant capability excludes the privacy path", () => {
  const pureLocal: ProductContext = { ...CONTEXT, hasUserAccounts: false, files: false, imageUpload: false, clipboard: false, location: false, cloudData: false, externalProcessing: false };
  const flow = compileFlow(pureLocal);
  const nodeIds = flow.stages.flatMap(s => s.nodes.map(n => n.id));
  assert.equal(nodeIds.includes("privacy-declaration"), false);
});

test("every compiled flow carries the registry coverage boundary", () => {
  const coverage = compileFlow(CONTEXT).ruleEvaluation.coverage;
  assert.equal(coverage?.schemaVersion, "registry-coverage@1");
  assert.equal(coverage?.level, "partial");
  assert.match(coverage?.boundary ?? "", /不代表没有更多要求/);
  assert.match(coverage?.boundary ?? "", /unverified coverage/);
  // Coverage is registry metadata, not per-case state: an all-decided local
  // tool flow carries the same boundary.
  const pureLocal: ProductContext = { ...CONTEXT, hasUserAccounts: false, files: false, imageUpload: false, clipboard: false, location: false, cloudData: false, externalProcessing: false };
  assert.deepEqual(compileFlow(pureLocal).ruleEvaluation.coverage, coverage);
});

test("parallel guidance identifies cross-stage work as startable without hard dependencies", () => {
  const flow = compileFlow(CONTEXT);
  const guidance = computeParallelGuidance(flow);
  assert.equal(guidance.schemaVersion, "parallel-guidance@1");
  const ids = guidance.startableNow.map(n => n.nodeId);
  // identity-account (stage 1) and migration-core-path (stage 3) are in
  // different stages with no recorded dependency between them.
  assert.equal(ids.includes("identity-account"), true);
  assert.equal(ids.includes("migration-core-path"), true);
  assert.equal(guidance.canRunInParallel, true);
  assert.match(guidance.disclaimer, /不等于微信官方确认/);
});

test("real dependencies are never recommended as parallel", () => {
  const flow = compileFlow(CONTEXT);
  const guidance = computeParallelGuidance(flow);
  const startable = guidance.startableNow.map(n => n.nodeId);
  // prod-verified depends on prod-published (which depends on ready-device,
  // filing-complete, privacy-declaration) — none of that chain may start now.
  assert.equal(startable.includes("prod-verified"), false);
  assert.equal(startable.includes("prod-published"), false);
  assert.equal(startable.includes("ready-device"), false);
  const notStartable = new Map(guidance.notStartableYet.map(n => [n.nodeId, n.missing]));
  assert.deepEqual(notStartable.get("prod-verified"), ["提交审核并发布"]);
  assert.equal(notStartable.get("prod-published")!.includes("完成小程序备案"), true);
  assert.equal(notStartable.get("prod-published")!.includes("体验版真机测试"), true);
  assert.deepEqual(notStartable.get("filing-complete"), ["注册小程序账号并获取 AppID"]);
  assert.deepEqual(notStartable.get("identity-category"), ["注册小程序账号并获取 AppID"]);
});

test("waiting on an external process does not stop independent work (parallel while waiting)", () => {
  const blocked = applyPatchToFlow(compileFlow(CONTEXT), {
    nodePatches: { "filing-complete": { status: "blocked", blocker: { summary: "备案审核中", diagnosis: "管局审核周期内等待", resolution: "等待结果；期间可继续开发" } } },
  });
  const guidance = computeParallelGuidance(blocked);
  assert.equal(guidance.waiting.some(w => w.nodeId === "filing-complete" && w.blockedOn === "备案审核中"), true);
  // Development work has no recorded dependency on filing and remains startable.
  assert.equal(guidance.startableNow.some(n => n.nodeId === "migration-core-path"), true);
  assert.equal(guidance.canRunInParallel, true);
});

test("a pending product decision still allows startable work (parallel with user decision)", () => {
  const withUnknown: ProductContext = { ...CONTEXT, hasUserAccounts: "unknown" };
  const flow = compileFlow(withUnknown);
  const guidance = computeParallelGuidance(flow);
  assert.equal(guidance.primary?.kind, "product_decision");
  assert.equal(guidance.canRunInParallel, true);
  assert.equal(guidance.startableNow.length >= 1, true);
  assert.equal(guidance.startableNow.some(n => n.nodeId === "migration-core-path"), true);
});

// ---- Next action shares the dependency eligibility of parallel guidance ----

const complete = (flow: Flow, ids: string[]) => applyPatchToFlow(flow, { humanStatuses: Object.fromEntries(ids.map(id => [id, "completed"])) });
const nextNodeId = (flow: Flow) => { const next = selectNextAction(flow); return next.kind === "node" || next.kind === "blocker" ? next.node.id : null; };

test("a node with unmet dependencies never becomes Next, even when proposed waiting", () => {
  // The old rule picked the first waiting node regardless of dependencies.
  const flow = applyPatchToFlow(baseFlow(), { nodePatches: { "prod-published": { status: "waiting" } } });
  assert.notEqual(nextNodeId(flow), "prod-published");
  assert.equal(startableNodes(flow).some(n => n.id === "prod-published"), false);
});

test("ready-preflight is not Next until its recorded dependencies are completed", () => {
  const flow = applyPatchToFlow(baseFlow(), { nodePatches: { "ready-preflight": { status: "waiting" } } });
  assert.notEqual(nextNodeId(flow), "ready-preflight");
  const ready = complete(flow, ["migration-core-path", "privacy-inventory", "privacy-declaration"]);
  assert.equal(nextNodeId(ready), "ready-preflight");
});

test("Next is always a member of parallel.startableNow (single eligibility source)", () => {
  const scenarios: Flow[] = [
    baseFlow(),
    applyPatchToFlow(baseFlow(), { nodePatches: { "prod-published": { status: "waiting" }, "ready-device": { status: "waiting" } } }),
    complete(baseFlow(), ["assess-context", "identity-account"]),
    complete(baseFlow(), baseFlow().stages.flatMap(s => s.nodes).map(n => n.id).filter(id => id !== "prod-verified")),
  ];
  for (const flow of scenarios) {
    const next = selectNextAction(flow);
    const guidance = computeParallelGuidance(flow);
    if (next.kind === "node") {
      assert.ok(guidance.startableNow.some(n => n.nodeId === next.node.id), next.node.id);
      assert.equal(guidance.primary?.nodeId, next.node.id);
    }
  }
  const last = scenarios[3];
  assert.equal(nextNodeId(last), "prod-verified");
});

test("stage order is presentation only: a later-stage startable node can be Next before an earlier blocked chain", () => {
  // identity-account completed unlocks stage-1/2 work; with assessment done,
  // Next follows dependency eligibility, not the stage list.
  const flow = complete(baseFlow(), ["assess-context"]);
  const next = selectNextAction(flow);
  assert.equal(next.kind, "node");
  const startable = new Set(startableNodes(flow).map(n => n.id));
  assert.ok(startable.has("migration-core-path"));
  assert.ok(startable.has("identity-account"));
  assert.equal(startable.has("identity-category"), false);
});

test("a blocker on work whose dependencies are unmet is not the primary action", () => {
  const flow = applyPatchToFlow(baseFlow(), { nodePatches: { "prod-published": { status: "blocked", blocker: { summary: "审核未通过", diagnosis: "x", resolution: "y" } } } });
  const next = selectNextAction(flow);
  assert.notEqual(next.kind === "blocker" ? next.node.id : null, "prod-published");
  assert.ok(computeParallelGuidance(flow).waiting.some(w => w.nodeId === "prod-published"));
});

test("all nodes completed yields done; an open blocker with satisfied dependencies is the primary action", () => {
  const all = baseFlow().stages.flatMap(s => s.nodes).map(n => n.id);
  assert.equal(selectNextAction(complete(baseFlow(), all)).kind, "done");
  // Everything completed except prod-verified, whose only dependency is blocked.
  const almost = applyPatchToFlow(complete(baseFlow(), all.filter(id => id !== "prod-verified" && id !== "prod-published")), {
    nodePatches: { "prod-published": { status: "blocked", blocker: { summary: "审核中", diagnosis: "x", resolution: "y" } } },
  });
  const next = selectNextAction(almost);
  assert.equal(next.kind, "blocker");
  assert.equal(next.kind === "blocker" ? next.node.id : null, "prod-published");
});

test("there is no default product: unreadable stores fail instead of becoming another product", () => {
  assert.throws(() => sanitizeStore(null), /not a JSON object/);
  assert.throws(() => sanitizeStore({ schemaVersion: "launch-state-store@0" }), /Unsupported Launch Truth store schema/);
  assert.throws(() => sanitizeStore({ schemaVersion: "launch-state-store@1", patch: {} }), /productId/);
});
