// Request semantics of the local development API (/api/launch-state) used by
// the dashboard. Kept out of the Vite plugin so it is testable with node:test.
//
// Two node write channels, never mixed:
//   - "status": the human channel (the dashboard status control). Any status,
//     including completed, recorded in humanStatuses as a human confirmation.
//   - "propose": the agent channel (the dashboard's WebMCP tool, or any other
//     agent-facing caller). Same contract as `launch-state submit`: proposals,
//     blockers and agent_submitted evidence only; never completed, never
//     humanStatuses.
// Case management ("create", "switch") goes through the same functions as the
// CLI's case-create / case-switch.
// This is a contract, not a security boundary: the API is unauthenticated and
// the Launch Truth files are plain local JSON.
import { applyHumanStatuses, applyStorePatch, buildFlowFromStore, buildSubmitDelta, resetStorePatch, updateStoreContext } from "./launch-store.ts";
import {
  CaseExistsError,
  CaseNotFoundError,
  ProductMismatchError,
  assertContextUpdateAllowed,
  createLaunchCase,
  deleteLaunchCase,
  listLaunchCases,
  loadActiveStore,
  saveStore,
  switchLaunchCase,
  validateContextForWrite,
} from "./launch-store-file.ts";
import { compileFlow } from "./flow-engine/compiler.ts";
import type { Flow, ProductContext, Status } from "./flow-engine/types.ts";
import type { CaseOrigin, LaunchStateStore, StorePatch } from "./launch-store-types.ts";

export type CaseListItem = { caseId: string; name: string; active: boolean };

export type TruthView = {
  // null when no Launch Case exists yet (fresh checkout).
  store: { schemaVersion: string; contextId: string; updatedAt: string; caseOrigin: CaseOrigin | null; patch: StorePatch } | null;
  flow: Flow | null;
  cases: CaseListItem[];
};

export type TruthErrorKind =
  | "invalid_request" | "invalid_status" | "proposal_rejected" | "invalid_context"
  | "product_mismatch" | "no_active_case" | "case_exists" | "case_not_found" | "write_failed";

export type TruthResponse =
  | { status: 200; body: { ok: true; accepted?: string[]; rejected?: string[] } & TruthView }
  | { status: 400 | 404 | 409 | 500; body: { ok: false; kind: TruthErrorKind; error: string; hint?: string; activeCaseId?: string; caseId?: string; rejected?: string[] } };

const LEGAL_STATUSES: Status[] = ["completed", "waiting", "blocked", "not_started"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function truthView(root: string): Promise<TruthView> {
  const store = await loadActiveStore(root);
  const listing = await listLaunchCases(root);
  return {
    store: store ? { schemaVersion: store.schemaVersion, contextId: store.contextId, updatedAt: store.updatedAt, caseOrigin: store.caseOrigin ?? null, patch: store.patch } : null,
    flow: store ? buildFlowFromStore(store) : null,
    cases: listing.cases.filter(c => !c.error).map(c => ({ caseId: c.caseId, name: c.name, active: c.active })),
  };
}

type FailExtra = { hint?: string; activeCaseId?: string; caseId?: string; rejected?: string[] };

function fail(status: 400 | 404 | 409 | 500, kind: TruthErrorKind, error: string, extra: FailExtra = {}): TruthResponse {
  return { status, body: { ok: false, kind, error, ...extra } };
}

async function ok(root: string, extra: { accepted?: string[]; rejected?: string[] } = {}): Promise<TruthResponse> {
  return { status: 200, body: { ok: true, ...extra, ...(await truthView(root)) } };
}

const NO_CASE_HINT = "Create a Launch Case first: dashboard \"添加我的产品\", or `launch-state case-create <product-context.json>`.";

export async function handleTruthRequest(root: string, payload: unknown): Promise<TruthResponse> {
  if (!isRecord(payload)) return fail(400, "invalid_request", "Request body must be a JSON object.");
  const action = typeof payload.action === "string" ? payload.action : "";
  try {
    if (action === "create") {
      const context = payload.productContext as ProductContext;
      try {
        await createLaunchCase(context, root);
      } catch (err) {
        if (err instanceof CaseExistsError) return fail(409, "case_exists", err.message, { caseId: err.caseId });
        return fail(400, "invalid_context", errorMessage(err));
      }
      return ok(root);
    }
    if (action === "switch") {
      const caseId = typeof payload.caseId === "string" ? payload.caseId : "";
      try {
        await switchLaunchCase(caseId, root);
      } catch (err) {
        if (err instanceof CaseNotFoundError) return fail(404, "case_not_found", err.message);
        throw err;
      }
      return ok(root);
    }
    if (action === "delete") {
      const caseId=typeof payload.caseId==="string"?payload.caseId:"";
      if (!caseId) return fail(400,"invalid_request","delete requires an exact caseId");
      try { await deleteLaunchCase(caseId,root); }
      catch (err) {
        if (err instanceof CaseNotFoundError) return fail(404,"case_not_found",err.message);
        throw err;
      }
      return ok(root);
    }

    const store: LaunchStateStore | null = await loadActiveStore(root);
    if (!store) {
      if (["status", "propose", "context", "reset"].includes(action)) return fail(409, "no_active_case", "No Launch Case yet.", { hint: NO_CASE_HINT });
      return fail(400, "invalid_request", `unknown action: ${action || "(missing)"}. Use create | switch | delete | status | propose | context | reset.`);
    }
    if (action === "status") {
      const knownIds = new Set(compileFlow(store.productContext).stages.flatMap(s => s.nodes).map(n => n.id));
      const statuses = isRecord(payload.humanStatuses) ? payload.humanStatuses : { [String(payload.nodeId)]: payload.status };
      for (const [nodeId, status] of Object.entries(statuses)) {
        if (!knownIds.has(nodeId)) return fail(400, "invalid_status", `unknown node: ${nodeId}`);
        if (!LEGAL_STATUSES.includes(status as Status)) return fail(400, "invalid_status", `invalid status for ${nodeId}: ${String(status)}`);
      }
      await saveStore(applyHumanStatuses(store, statuses), root);
      return ok(root);
    }
    if (action === "propose") {
      const outcome = buildSubmitDelta(store.productContext, payload);
      if (!outcome.delta.nodePatches) {
        return fail(400, "proposal_rejected", `proposal rejected: ${outcome.rejected.join("; ") || "no valid patches"}`, { rejected: outcome.rejected });
      }
      await saveStore(applyStorePatch(store, outcome.delta), root);
      return ok(root, { accepted: outcome.accepted, rejected: outcome.rejected });
    }
    if (action === "context") {
      const next = payload.productContext as ProductContext;
      try {
        validateContextForWrite(next);
      } catch (err) {
        return fail(400, "invalid_context", errorMessage(err));
      }
      try {
        assertContextUpdateAllowed(store, next);
      } catch (err) {
        if (err instanceof ProductMismatchError) {
          return fail(409, "product_mismatch", err.message, {
            activeCaseId: err.activeCaseId,
            hint: "This data belongs to another product. Add it as a new product instead (dashboard \"添加产品\" or `launch-state case-create`).",
          });
        }
        throw err;
      }
      await saveStore(updateStoreContext(store, next), root);
      return ok(root);
    }
    if (action === "reset") {
      // Fresh state for the SAME launch case: ProductContext and case identity
      // preserved, agent/human patches cleared.
      await saveStore(resetStorePatch(store), root);
      return ok(root);
    }
    return fail(400, "invalid_request", `unknown action: ${action || "(missing)"}. Use create | switch | delete | status | propose | context | reset.`);
  } catch (err) {
    return fail(500, "write_failed", errorMessage(err));
  }
}
