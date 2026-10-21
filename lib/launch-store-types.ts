import type { Blocker, Evidence, ProductContext, Status } from "./flow-engine/types.ts";
export type NodeStatusProposal = Exclude<Status, "completed">;

// A Launch Case is the first-class object: one product × one launch target.
// The only supported target today is the WeChat Mini Program launch.
export const LAUNCH_TARGET = "wechat-launch";

export function deriveCaseId(productId: string) {
  return `${productId}:${LAUNCH_TARGET}`;
}

// Provenance of a case's initial state: "fixture" = seeded from a registry
// fictional example fixture (no real product facts), "runtime" = adopted from a
// previously active truth file, "created" = created fresh via case-create.
export type CaseOrigin = "fixture" | "runtime" | "created";

export type NodePatch = {
  status?: NodeStatusProposal;
  blocker?: Blocker | null;
  evidence?: Evidence[];
};

export type StorePatch = {
  statuses?: Record<string, NodeStatusProposal>;
  nodePatches?: Record<string, NodePatch>;
  // Human-only channel (dashboard status select): status facts authored by
  // the human, including completed. "completed" is a human confirmation, not a
  // machine verification. Agent-facing channels (CLI submit/propose-*, WebMCP)
  // never write it; applied after agent proposals so the human outranks them.
  humanStatuses?: Record<string, Status>;
};

export type LaunchStateStore = {
  schemaVersion: "launch-state-store@1";
  updatedAt: string;
  contextId: string;
  productContext: ProductContext;
  patch: StorePatch;
  caseOrigin?: CaseOrigin;
};
