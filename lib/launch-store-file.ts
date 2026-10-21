import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRODUCT_CONTEXT_FIELDS, validateProductContext } from "./flow-engine/compiler.ts";
import { PRODUCT_ID_PATTERN, emptyStore, sanitizeStore } from "./launch-store.ts";
import type { ProductContext } from "./flow-engine/types.ts";
import type { CaseOrigin, LaunchStateStore } from "./launch-store-types.ts";
import { deriveCaseId } from "./launch-store-types.ts";

export const STORE_REL = "public/flows/launch-state.json";
export const CASES_REL = "public/flows/launch-cases";

// Case ids contain ":" (productId:target), which is not filename-safe.
function caseFileStem(caseId: string) {
  return caseId.replace(/[^a-zA-Z0-9._-]+/g, "--");
}

export function caseFilePath(caseId: string, root = process.cwd()) {
  return path.join(root, CASES_REL, `${caseFileStem(caseId)}.json`);
}

export function storePath(root = process.cwd()) {
  return path.join(root, STORE_REL);
}

function isMissingFile(err: unknown) {
  return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function readJson<T = unknown>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, "utf8")) as T;
}

export async function writeJsonAtomic(p: string, data: unknown) {
  await mkdir(path.dirname(p), { recursive: true });
  const staging = p + ".staging";
  await writeFile(staging, JSON.stringify(data, null, 2) + "\n");
  JSON.parse(await readFile(staging, "utf8"));
  await rename(staging, p);
}

// The active Launch Case, or null when none has been created yet. A fresh
// checkout has no product: nothing is pre-installed.
export async function loadActiveStore(root = process.cwd()): Promise<LaunchStateStore | null> {
  try {
    return sanitizeStore(await readJson(storePath(root)));
  } catch (err) {
    if (isMissingFile(err)) return null;
    throw err;
  }
}

export class NoActiveCaseError extends Error {
  constructor() {
    super('No Launch Case yet. Create one from the dashboard ("添加我的产品") or with: launch-state case-create <product-context.json> (template: examples/product-context.json).');
    this.name = "NoActiveCaseError";
  }
}

export async function requireActiveStore(root = process.cwd()): Promise<LaunchStateStore> {
  const store = await loadActiveStore(root);
  if (!store) throw new NoActiveCaseError();
  return store;
}

export class CaseExistsError extends Error {
  readonly caseId: string;
  constructor(caseId: string) {
    super(`case already exists: ${caseId}. Use "launch-state case-switch ${caseId}" to activate it.`);
    this.name = "CaseExistsError";
    this.caseId = caseId;
  }
}

// The single creation path for a Launch Case (CLI case-create and the
// dashboard's "add my product").
export async function createLaunchCase(context: ProductContext, root = process.cwd(), options: { switchTo?: boolean; origin?: CaseOrigin } = {}): Promise<LaunchStateStore> {
  if (typeof context?.productId !== "string" || !PRODUCT_ID_PATTERN.test(context.productId)) {
    throw new Error("productContext.productId is missing or not a valid id (letters, digits, '.', '_', '-').");
  }
  validateContextForWrite(context);
  const caseId = deriveCaseId(context.productId);
  try {
    await readFile(caseFilePath(caseId, root));
    throw new CaseExistsError(caseId);
  } catch (err) {
    if (!isMissingFile(err)) throw err;
  }
  const store: LaunchStateStore = { ...emptyStore(context), caseOrigin: options.origin ?? "created" };
  if (options.switchTo === false) {
    await writeJsonAtomic(caseFilePath(caseId, root), sanitizeStore(store));
    return sanitizeStore(store);
  }
  return persistStore(store, root);
}

// The active truth file (public/flows/launch-state.json) is what the CLI and
// the dashboard consume; the per-case file under public/flows/launch-cases/ is
// the durable copy that makes Launch Cases switchable. Every write goes
// through here so the two never drift.
export class CaseNotFoundError extends Error {
  constructor(caseId: string, detail: string) {
    super(`case not found or unreadable: ${caseId} (${detail}). Use "launch-state cases" to list existing cases.`);
    this.name = "CaseNotFoundError";
  }
}

// The single switch path (CLI case-switch and the dashboard product selector).
// The current case is persisted first, in case anything wrote the active file
// without syncing its case file.
export async function switchLaunchCase(caseId: string, root = process.cwd()): Promise<{ from: string | null; to: LaunchStateStore; switched: boolean }> {
  const current = await loadActiveStore(root);
  if (current?.contextId === caseId) return { from: caseId, to: current, switched: false };
  let target: LaunchStateStore;
  try {
    target = sanitizeStore(await readJson(caseFilePath(caseId, root)));
  } catch (err) {
    throw new CaseNotFoundError(caseId, errorMessage(err));
  }
  if (current) await persistStore(current, root);
  return { from: current?.contextId ?? null, to: await persistStore(target, root), switched: true };
}

export type DeleteLaunchCaseResult = { deletedCaseId:string; nextActiveCaseId:string|null };

// Exact-case deletion used by the dashboard. Callers must show a human
// confirmation first. The target is validated before any write; other case
// files are never rewritten. When deleting the active case, a valid fallback
// is activated first. With no fallback, both duplicate copies are removed;
// failure restores the validated store so partial deletion is not reported.
export async function deleteLaunchCase(caseId:string,root=process.cwd()):Promise<DeleteLaunchCaseResult> {
  const active=await loadActiveStore(root);
  let target:LaunchStateStore;
  try { target=sanitizeStore(await readJson(caseFilePath(caseId,root))); }
  catch (err) {
    if (active?.contextId===caseId) target=active;
    else throw new CaseNotFoundError(caseId,errorMessage(err));
  }
  if (target.contextId!==caseId) throw new CaseNotFoundError(caseId,"case identity mismatch");
  const listing=await listLaunchCases(root);
  const fallback=listing.cases.find(item=>!item.error&&item.caseId!==caseId);
  if (active?.contextId===caseId&&fallback) {
    await switchLaunchCase(fallback.caseId,root);
    try { await rm(caseFilePath(caseId,root)); }
    catch (err) {
      // The target still exists, so restore it as active instead of leaving a
      // failed deletion looking like a successful product switch.
      await switchLaunchCase(caseId,root);
      throw err;
    }
    return {deletedCaseId:caseId,nextActiveCaseId:fallback.caseId};
  }
  if (active?.contextId===caseId) {
    try {
      await rm(caseFilePath(caseId,root));
      await rm(storePath(root));
    } catch (err) {
      await persistStore(target,root);
      throw err;
    }
    return {deletedCaseId:caseId,nextActiveCaseId:null};
  }
  await rm(caseFilePath(caseId,root));
  return {deletedCaseId:caseId,nextActiveCaseId:active?.contextId??null};
}

export async function persistStore(store: LaunchStateStore, root = process.cwd()): Promise<LaunchStateStore> {
  const sanitized = sanitizeStore(store);
  await writeJsonAtomic(storePath(root), sanitized);
  await writeJsonAtomic(caseFilePath(sanitized.contextId, root), sanitized);
  return sanitized;
}

export async function saveStore(store: LaunchStateStore, root = process.cwd()): Promise<LaunchStateStore> {
  return persistStore(store, root);
}

export type LaunchCaseSummary = {
  caseId: string;
  productId: string;
  name: string;
  origin: string | null;
  updatedAt: string;
  active: boolean;
  pendingProposals: number;
  humanStatuses: number;
  error?: string;
};

export async function listLaunchCases(root = process.cwd()): Promise<{ activeCaseId: string | null; cases: LaunchCaseSummary[] }> {
  const active = await loadActiveStore(root);
  const dir = path.join(root, CASES_REL);
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort();
  } catch (err) {
    if (!isMissingFile(err)) throw err;
  }
  const cases: LaunchCaseSummary[] = [];
  for (const file of files) {
    try {
      const store = sanitizeStore(await readJson(path.join(dir, file)));
      const patch = store.patch;
      cases.push({
        caseId: store.contextId,
        productId: store.productContext.productId,
        name: store.productContext.name,
        origin: store.caseOrigin ?? null,
        updatedAt: store.updatedAt,
        active: store.contextId === active?.contextId,
        pendingProposals: Object.keys(patch.statuses ?? {}).length + Object.keys(patch.nodePatches ?? {}).length,
        humanStatuses: Object.keys(patch.humanStatuses ?? {}).length,
      });
    } catch (err) {
      cases.push({
        caseId: file.replace(/\.json$/, ""),
        productId: "",
        name: "",
        origin: null,
        updatedAt: "",
        active: false,
        pendingProposals: 0,
        humanStatuses: 0,
        error: errorMessage(err),
      });
    }
  }
  cases.sort((a, b) => a.caseId.localeCompare(b.caseId));
  return { activeCaseId: active?.contextId ?? null, cases };
}

// Raised when a write targets a different product than the active case. The
// dashboard and CLI report it as such instead of a generic write failure.
export class ProductMismatchError extends Error {
  readonly activeCaseId: string;
  readonly payloadProductId: string;
  constructor(activeCaseId: string, activeProductId: string, payloadProductId: string) {
    super(
      `Product mismatch: active case is "${activeCaseId}" (${activeProductId}), payload is "${payloadProductId}". ` +
      `Use "launch-state case-create" for a new product or "launch-state case-switch" to change cases; context-set only updates facts of the active case.`,
    );
    this.name = "ProductMismatchError";
    this.activeCaseId = activeCaseId;
    this.payloadProductId = payloadProductId;
  }
}

// ProductContext updates are same-case operations. A different productId means
// a different Launch Case: it must never silently overwrite the active one.
export function assertContextUpdateAllowed(current: LaunchStateStore, next: ProductContext) {
  validateContextForWrite(next);
  if (next.productId !== current.productContext.productId) {
    throw new ProductMismatchError(current.contextId, current.productContext.productId, next.productId);
  }
}

// Shared ProductContext gate for every write channel (CLI context-set,
// dashboard builder). Unknown extra fields and null values are rejected, so a
// machine can never silently invent or erase product facts.
export function validateContextForWrite(context: ProductContext) {
  validateProductContext(context);
  const allowed = new Set<string>(PRODUCT_CONTEXT_FIELDS);
  const extra = Object.keys(context).filter(key => !allowed.has(key));
  if (extra.length) throw new Error(`Unknown ProductContext fields: ${extra.join(", ")}`);
}
