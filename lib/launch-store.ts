import type { Blocker, Evidence, Flow, ProductContext, Status } from "./flow-engine/types.ts";
import { compileFlow } from "./flow-engine/compiler.ts";
import {
  deriveCaseId,
  type CaseOrigin,
  type LaunchStateStore,
  type NodePatch,
  type NodeStatusProposal,
  type StorePatch,
} from "./launch-store-types.ts";

const VALID_PROPOSALS = new Set<Status>(["not_started", "waiting", "blocked"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeStatus(value: unknown): NodeStatusProposal | undefined {
  if (typeof value === "string" && VALID_PROPOSALS.has(value as Status)) {
    return value as NodeStatusProposal;
  }
  return undefined;
}

function sanitizeEvidence(value: unknown, defaultVerifiedBy: string): Evidence[] {
  if (!Array.isArray(value)) return [];
  const out: Evidence[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const e = raw as Partial<Evidence>;
    const type_ = typeof e.type === "string" && e.type ? e.type : "agent_submitted";
    const label = typeof e.label === "string" && e.label ? e.label : "untitled";
    const val = typeof e.value === "string" ? e.value : String(e.value ?? "");
    if (!val) continue;
    // Attribution belongs to the submission channel, never to the payload: an
    // agent-submitted item claiming verifiedBy "human" must not survive.
    out.push({ type: type_, label, value: val, verifiedBy: defaultVerifiedBy });
  }
  return out;
}

function sanitizeBlocker(value: unknown): Blocker | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const b = value as Partial<Blocker>;
  if (typeof b.summary !== "string" || !b.summary) return undefined;
  if (typeof b.diagnosis !== "string" || !b.diagnosis) return undefined;
  if (typeof b.resolution !== "string" || !b.resolution) return undefined;
  return { summary: b.summary, diagnosis: b.diagnosis, resolution: b.resolution };
}

// Human dashboard channel: status facts written by the human. Any legal Status
// (including completed) is allowed here; agent-facing channels never reach it.
export function sanitizeHumanStatuses(raw: unknown): Record<string, Status> {
  const legal: Status[] = ["completed", "waiting", "blocked", "not_started"];
  const out: Record<string, Status> = {};
  if (!isRecord(raw)) return out;
  for (const [nodeId, value] of Object.entries(raw)) {
    if (typeof value === "string" && legal.includes(value as Status)) out[nodeId] = value as Status;
  }
  return out;
}

export function sanitizeNodePatch(raw: unknown, defaultVerifiedBy = "agent_submitted"): NodePatch | undefined {
  if (!isRecord(raw)) return undefined;
  const patch: NodePatch = {};
  if (Object.prototype.hasOwnProperty.call(raw, "status")) {
    const s = sanitizeStatus(raw.status);
    if (s !== undefined) patch.status = s;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "blocker")) {
    const b = sanitizeBlocker(raw.blocker);
    if (b !== undefined) patch.blocker = b;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "evidence")) {
    const ev = sanitizeEvidence(raw.evidence, defaultVerifiedBy);
    if (ev.length) patch.evidence = ev;
  }
  return Object.keys(patch).length ? patch : undefined;
}

export function sanitizePatch(patch: unknown, defaultVerifiedBy = "agent_submitted"): StorePatch {
  if (!isRecord(patch)) return {};
  const next: StorePatch = {};
  if (isRecord(patch.statuses)) {
    const statuses: Record<string, NodeStatusProposal> = {};
    for (const [nodeId, value] of Object.entries(patch.statuses)) {
      const s = sanitizeStatus(value);
      if (s !== undefined) statuses[nodeId] = s;
    }
    if (Object.keys(statuses).length) next.statuses = statuses;
  }
  if (isRecord(patch.nodePatches)) {
    const nodePatches: Record<string, NodePatch> = {};
    for (const [nodeId, value] of Object.entries(patch.nodePatches)) {
      const p = sanitizeNodePatch(value, defaultVerifiedBy);
      if (p) nodePatches[nodeId] = p;
    }
    if (Object.keys(nodePatches).length) next.nodePatches = nodePatches;
  }
  return next;
}

export type SubmitDelta = {
  delta: StorePatch;
  accepted: string[];
  rejected: string[];
};

// Single validation path for every agent-facing submission channel (CLI
// submit/propose-*, the dashboard's WebMCP tool via the dev API "propose"
// action). Enforces the interface contract: known nodes only, completed never
// accepted, sanitized proposals only, never humanStatuses.
export function buildSubmitDelta(productContext: ProductContext, payload: unknown): SubmitDelta {
  const knownIds = new Set(compileFlow(productContext).stages.flatMap(s => s.nodes).map(n => n.id));
  const rejected: string[] = [];
  const patches: Record<string, NodePatch> = {};
  if (isRecord(payload)) {
    const raw = payload.nodePatches;
    if (isRecord(raw)) {
      for (const [nodeId, rawPatch] of Object.entries(raw)) {
        if (!knownIds.has(nodeId)) { rejected.push(`${nodeId}:unknown_node`); continue; }
        if (isRecord(rawPatch) && rawPatch.status === "completed") { rejected.push(`${nodeId}:completed_not_allowed`); continue; }
        const nodePatch = sanitizeNodePatch(rawPatch, "agent_submitted");
        if (!nodePatch) { rejected.push(`${nodeId}:empty_or_invalid`); continue; }
        patches[nodeId] = nodePatch;
      }
    }
    if (payload.statuses !== undefined) {
      rejected.push("statuses:use_nodePatches_status_instead (deprecated to prevent accidental completed)");
    }
    if (payload.humanStatuses !== undefined) {
      rejected.push("humanStatuses:human_channel_not_writable_by_agents");
    }
  }
  const delta: StorePatch = {};
  if (Object.keys(patches).length) delta.nodePatches = patches;
  return { delta, accepted: Object.keys(patches), rejected };
}

function mergePatch(oldPatch: StorePatch, delta: StorePatch): StorePatch {
  const statuses: Record<string, NodeStatusProposal> = { ...(oldPatch.statuses ?? {}), ...(delta.statuses ?? {}) };
  const humanStatuses: Record<string, Status> = { ...(oldPatch.humanStatuses ?? {}), ...(delta.humanStatuses ?? {}) };
  const nodePatches: Record<string, NodePatch> = {};
  const allIds = new Set([
    ...Object.keys(oldPatch.nodePatches ?? {}),
    ...Object.keys(delta.nodePatches ?? {}),
  ]);
  for (const id of allIds) {
    const old = oldPatch.nodePatches?.[id];
    const incoming = delta.nodePatches?.[id];
    const merged: NodePatch = {};
    const evidenceAcc: Evidence[] = [];
    if (old?.evidence) evidenceAcc.push(...old.evidence);
    if (old?.status) merged.status = old.status;
    if (old?.blocker !== undefined) merged.blocker = old.blocker;
    if (incoming?.evidence) evidenceAcc.push(...incoming.evidence);
    if (incoming?.status) merged.status = incoming.status;
    if (incoming?.blocker !== undefined) merged.blocker = incoming.blocker;
    if (evidenceAcc.length) merged.evidence = evidenceAcc;
    if (Object.keys(merged).length) nodePatches[id] = merged;
  }
  const result: StorePatch = {};
  if (Object.keys(statuses).length) result.statuses = statuses;
  if (Object.keys(nodePatches).length) result.nodePatches = nodePatches;
  if (Object.keys(humanStatuses).length) result.humanStatuses = humanStatuses;
  return result;
}

// Agent-facing channels (sanitizePatch, buildSubmitDelta) never produce
// humanStatuses; only the human dashboard status control reaches this.
export function applyHumanStatuses(store: LaunchStateStore, raw: unknown): LaunchStateStore {
  const humanStatuses = sanitizeHumanStatuses(raw);
  if (!Object.keys(humanStatuses).length) return store;
  return applyStorePatch(store, { humanStatuses });
}

export function applyPatchToFlow(flow: Flow, patch: unknown): Flow {
  const clean = sanitizePatch(patch, "agent_submitted");
  const nodeMap = new Map<string, NodePatch>();
  if (clean.statuses) {
    for (const [id, status] of Object.entries(clean.statuses)) {
      nodeMap.set(id, { ...(nodeMap.get(id) ?? {}), status });
    }
  }
  if (clean.nodePatches) {
    for (const [id, p] of Object.entries(clean.nodePatches)) {
      nodeMap.set(id, { ...(nodeMap.get(id) ?? {}), ...p });
    }
  }
  // Human status facts are applied last: the dashboard status control outranks
  // agent proposals for the same node, including human-confirmed completion.
  const humanStatuses = isRecord(patch) ? sanitizeHumanStatuses(patch.humanStatuses) : {};
  return {
    ...flow,
    stages: flow.stages.map(stage => ({
      ...stage,
      nodes: stage.nodes.map(node => {
        const patch_ = nodeMap.get(node.id);
        const human = humanStatuses[node.id];
        if (!patch_ && human === undefined) return node;
        const updated = { ...node };
        if (patch_?.status) updated.status = patch_.status;
        if (patch_?.evidence?.length) {
          updated.evidence = [...(updated.evidence ?? []), ...patch_.evidence];
        }
        if (patch_ && Object.prototype.hasOwnProperty.call(patch_, "blocker")) {
          updated.blocker = patch_.blocker ?? null;
        }
        if (human !== undefined) updated.status = human;
        return updated;
      }),
    })),
  };
}

// A ProductContext with every fact unknown: the starting point for a new
// product (same shape as examples/product-context.json).
export function blankProductContext(productId: string, name: string): ProductContext {
  return {
    schemaVersion: "1.1", productId, name,
    subjectType: "unknown", category: "unknown",
    existingProduct: "unknown", hasWechatAccount: "unknown", hasUserAccounts: "unknown", cloudData: "unknown", externalProcessing: "unknown",
    payment: "unknown", monetizationModel:"unknown", transactionObject:"unknown", paymentChannel:"unknown", permanentEntitlement: "unknown", reminder: "unknown", files: "unknown", imageUpload: "unknown",
    clipboard: "unknown", ugcText: "unknown", ugcImages: "unknown", location: "unknown",
  };
}

export const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

// Stable id for a product named in the dashboard. Names without usable ASCII
// characters (e.g. Chinese names) get a generated id.
export function productIdFromName(name: string, now = Date.now()): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return PRODUCT_ID_PATTERN.test(slug) ? slug : `product-${now.toString(36)}`;
}

export function emptyStore(pc: ProductContext): LaunchStateStore {
  return {
    schemaVersion: "launch-state-store@1",
    updatedAt: new Date().toISOString(),
    contextId: deriveCaseId(pc.productId),
    productContext: pc,
    patch: {},
  };
}

// Fresh state for the SAME launch case: identity and ProductContext preserved,
// all agent proposals and human statuses cleared.
export function resetStorePatch(store: LaunchStateStore): LaunchStateStore {
  return {
    schemaVersion: "launch-state-store@1",
    updatedAt: new Date().toISOString(),
    contextId: store.contextId,
    productContext: store.productContext,
    patch: {},
    ...(store.caseOrigin ? { caseOrigin: store.caseOrigin } : {}),
  };
}

const LEGACY_ACTIVE_CONTEXT_IDS = new Set(["active", ""]);

// There is no default product: anything that is not a recognizable store
// fails loudly instead of being replaced by some other product's state.
export function sanitizeStore(raw: unknown): LaunchStateStore {
  if (!isRecord(raw)) throw new Error("Launch Truth store is not a JSON object.");
  if (raw.schemaVersion !== "launch-state-store@1") {
    throw new Error(`Unsupported Launch Truth store schema "${String(raw.schemaVersion)}"; expected "launch-state-store@1".`);
  }
  const rawPc = isRecord(raw.productContext) ? raw.productContext : null;
  if (!rawPc || typeof rawPc.productId !== "string" || !rawPc.productId) {
    throw new Error("Launch Truth store has no productContext.productId.");
  }
  const pc = rawPc as ProductContext;
  const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : new Date(0).toISOString();
  const patch = sanitizePatch(raw.patch, "agent_submitted");
  const humanStatuses = sanitizeHumanStatuses(isRecord(raw.patch) ? raw.patch.humanStatuses : {});
  if (Object.keys(humanStatuses).length) patch.humanStatuses = humanStatuses;
  // The case id is always derived from productId + launch target; legacy
  // stores carrying contextId "active" (or a stale value) self-heal on load.
  if (!LEGACY_ACTIVE_CONTEXT_IDS.has(String(raw.contextId)) && typeof raw.contextId === "string" && raw.contextId !== deriveCaseId(pc.productId)) {
    throw new Error(`Launch case id mismatch: store says "${raw.contextId}" but productContext implies "${deriveCaseId(pc.productId)}"`);
  }
  const out: LaunchStateStore = {
    schemaVersion: "launch-state-store@1",
    updatedAt,
    contextId: deriveCaseId(pc.productId),
    productContext: pc,
    patch,
  };
  const origin = raw.caseOrigin as CaseOrigin | undefined;
  if (origin === "fixture" || origin === "runtime" || origin === "created") out.caseOrigin = origin;
  return out;
}

export function applyStorePatch(store: LaunchStateStore, delta: StorePatch): LaunchStateStore {
  const merged = mergePatch(store.patch, delta);
  return {
    schemaVersion: "launch-state-store@1",
    updatedAt: new Date().toISOString(),
    contextId: store.contextId,
    productContext: store.productContext,
    patch: merged,
    ...(store.caseOrigin ? { caseOrigin: store.caseOrigin } : {}),
  };
}

export function updateStoreContext(store: LaunchStateStore, productContext: ProductContext): LaunchStateStore {
  return {
    schemaVersion: "launch-state-store@1",
    updatedAt: new Date().toISOString(),
    contextId: deriveCaseId(productContext.productId),
    productContext,
    patch: store.patch,
    ...(store.caseOrigin ? { caseOrigin: store.caseOrigin } : {}),
  };
}

// Compiled flow + recorded proposals/human statuses. Every node's status comes
// from this store only; nothing is derived from LSE's own repository health.
export function buildFlowFromStore(store: LaunchStateStore): Flow {
  return applyPatchToFlow(compileFlow(store.productContext), store.patch);
}
