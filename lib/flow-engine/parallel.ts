// Derived launch guidance. Stage membership is presentational grouping; the
// only recorded execution constraints are node dependencies. This module is
// the single eligibility source for both Next and Parallel guidance:
//   - startableNodes(): work whose recorded dependencies are all completed;
//   - selectNextAction(): the one primary action, always picked from the
//     startable set (or a pending product decision / a startable blocker);
//   - computeParallelGuidance(): the same startable set, shown as concurrent
//     opportunities around that primary action.
// It never claims official parallel-safety: "no known hard dependency" is a
// dependency-graph statement, not a WeChat rule statement, and it never
// changes applicability or status.
import type { Actor, Flow, FlowDecision, FlowNode } from "./types.ts";

export type NextAction =
  | { kind: "product_decision"; decision: FlowDecision }
  | { kind: "blocker"; node: FlowNode }
  | { kind: "node"; node: FlowNode }
  // Incomplete nodes remain but none has its recorded dependencies satisfied
  // and none is a startable blocker (e.g. every open path waits on a blocker
  // further down the graph).
  | { kind: "no_startable_node" }
  | { kind: "done" };

export type ParallelGuidance = {
  schemaVersion: "parallel-guidance@1";
  primary: { nodeId: string; kind: NextAction["kind"] } | null;
  startableNow: { nodeId: string; title: string; stageId: string; actorType: Actor; basis: string }[];
  canRunInParallel: boolean;
  waiting: { nodeId: string; title: string; blockedOn: string | null }[];
  notStartableYet: { nodeId: string; title: string; missing: string[] }[];
  provenance: string;
  disclaimer: string;
};

export const DEPENDENCY_BASIS = "recorded dependencies satisfied (dependency graph)";
const PROVENANCE = "dependency-graph: startability is derived from the node dependencies recorded by LSE; stage order is presentational grouping, not execution order.";
const DISCLAIMER = "「无已知硬依赖」不等于微信官方确认可以并行；涉及外部审核/备案类工作的并行性以官方流程与当前 blocker 为准。本输出不是项目排期，不改变任何节点状态。";

function flowNodes(flow: Flow) {
  return flow.stages.flatMap(s => s.nodes);
}

// Dependencies not yet completed. A dependency on a node that is not part of
// this compiled flow (excluded capability) does not constrain anything.
export function unmetDependencies(flow: Flow, node: { dependencies: string[] }): string[] {
  const byId = new Map(flowNodes(flow).map(n => [n.id, n]));
  return node.dependencies.filter(id => byId.has(id) && byId.get(id)!.status !== "completed");
}

export function startableNodes(flow: Flow): FlowNode[] {
  return flowNodes(flow).filter(n =>
    n.status !== "completed" && n.status !== "blocked" && unmetDependencies(flow, n).length === 0);
}

export function selectNextAction(flow: Flow): NextAction {
  const decision = flow.undeterminedCapabilities[0];
  if (decision) return { kind: "product_decision", decision };
  const nodes = flowNodes(flow);
  // A blocker is the primary action only when its node could otherwise start;
  // a blocker reported on downstream work stays visible in waiting[] but is
  // not presented as the thing to do now.
  const blocker = nodes.find(n => n.status === "blocked" && unmetDependencies(flow, n).length === 0);
  if (blocker) return { kind: "blocker", node: blocker };
  const startable = startableNodes(flow);
  const next = startable.find(n => n.status === "waiting") ?? startable[0];
  if (next) return { kind: "node", node: next };
  return nodes.every(n => n.status === "completed") ? { kind: "done" } : { kind: "no_startable_node" };
}

function primaryOf(next: NextAction): ParallelGuidance["primary"] {
  if (next.kind === "blocker" || next.kind === "node") return { nodeId: next.node.id, kind: next.kind };
  if (next.kind === "product_decision") return { nodeId: next.decision.nodeId, kind: next.kind };
  return { nodeId: "", kind: next.kind };
}

export function computeParallelGuidance(flow: Flow): ParallelGuidance {
  const nodes = flowNodes(flow);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const next = selectNextAction(flow);

  const startableNow = startableNodes(flow).map(n => ({
    nodeId: n.id,
    title: n.title,
    stageId: n.stageId,
    actorType: n.actorType,
    basis: DEPENDENCY_BASIS,
  }));

  const waiting = nodes.filter(n => n.status === "blocked").map(n => ({
    nodeId: n.id,
    title: n.title,
    blockedOn: n.blocker?.summary ?? null,
  }));

  const notStartableYet = nodes
    .filter(n => n.status !== "completed" && n.status !== "blocked" && unmetDependencies(flow, n).length > 0)
    .map(n => ({
      nodeId: n.id,
      title: n.title,
      missing: unmetDependencies(flow, n).map(id => byId.get(id)?.title ?? id),
    }));

  // Parallel opportunity: at least two simultaneous work streams. A pending
  // user decision or a blocker counts as one stream (the user decides or the
  // blocker is resolved while other startable work continues).
  const primaryNodeId = next.kind === "node" || next.kind === "blocker" ? next.node.id : null;
  const others = startableNow.filter(n => n.nodeId !== primaryNodeId);
  const primaryIsStream = next.kind === "product_decision" || next.kind === "blocker" || next.kind === "node";
  const canRunInParallel = primaryIsStream && others.length >= 1;

  return {
    schemaVersion: "parallel-guidance@1",
    primary: primaryOf(next),
    startableNow,
    canRunInParallel,
    waiting,
    notStartableYet,
    provenance: PROVENANCE,
    disclaimer: DISCLAIMER,
  };
}
