import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES } from "../lib/flow-engine/fixtures.ts";
import type { ProductContext } from "../lib/flow-engine/types.ts";

const CLI = fileURLToPath(new URL("../scripts/launch-state.cli.ts", import.meta.url));
const WRITABLE_NODE = "migration-core-path";

const EXAMPLE_CASE = "example-productivity-app:wechat-launch";

async function makeEmptyRoot() {
  return mkdtemp(path.join(tmpdir(), "lse-cli-test-"));
}

// A checkout with one active Launch Case created from the fictional
// productivity fixture.
async function makeRoot() {
  const root = await makeEmptyRoot();
  const created = runCli(["case-create", "--from-fixture", "productivity"], root);
  assert.equal(created.status, 0, created.stderr);
  return root;
}

function runCli(args: string[], root: string) {
  return spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], { cwd: root, encoding: "utf8" });
}

async function readStore(root: string) {
  return JSON.parse(await readFile(path.join(root, "public", "flows", "launch-state.json"), "utf8"));
}

test("a fresh checkout has no product until one is created", async () => {
  const root = await makeEmptyRoot();
  try {
    const listing = JSON.parse(runCli(["cases", "--pretty"], root).stdout);
    assert.equal(listing.activeCaseId, null);
    assert.deepEqual(listing.cases, []);
    const status = runCli(["status"], root);
    assert.equal(status.status, 2);
    assert.match(status.stderr, /No Launch Case yet/);
    assert.match(status.stderr, /case-create/);
    // Reading does not create anything.
    assert.equal(JSON.parse(runCli(["cases"], root).stdout).cases.length, 0);

    const template = fileURLToPath(new URL("../examples/product-context.json", import.meta.url));
    assert.equal(runCli(["case-create", template], root).status, 0);
    const reset = JSON.parse(runCli(["reset", "--pretty"], root).stdout);
    assert.equal(reset.caseId, "my-product:wechat-launch");
    const store = await readStore(root);
    assert.deepEqual(store.patch, {});
    assert.equal(store.caseOrigin, "created");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("submit rejects completed status and leaves the store unchanged", async () => {
  const root = await makeRoot();
  try {
    const payload = path.join(root, "payload.json");
    await writeFile(payload, JSON.stringify({ nodePatches: { [WRITABLE_NODE]: { status: "completed" } } }));
    const result = runCli(["submit", payload], root);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /completed_not_allowed/);
    const store = await readStore(root);
    assert.deepEqual(store.patch, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("submit treats ready-preflight like any node: proposals yes, completed never", async () => {
  const root = await makeRoot();
  try {
    const payload = path.join(root, "payload.json");
    await writeFile(payload, JSON.stringify({ nodePatches: { "ready-preflight": { status: "completed" } } }));
    const refused = runCli(["submit", payload], root);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /completed_not_allowed/);
    await writeFile(payload, JSON.stringify({ nodePatches: { "ready-preflight": { status: "waiting" } } }));
    assert.equal(runCli(["submit", payload], root).status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("submit rejects the deprecated top-level statuses field", async () => {
  const root = await makeRoot();
  try {
    const payload = path.join(root, "payload.json");
    await writeFile(payload, JSON.stringify({ statuses: { [WRITABLE_NODE]: "waiting" } }));
    const result = runCli(["submit", payload], root);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /statuses:use_nodePatches_status_instead/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("propose-evidence appends agent_submitted evidence and never completes the node", async () => {
  const root = await makeRoot();
  try {
    const result = runCli(["propose-evidence", WRITABLE_NODE, "build_log", "Local build passed", "exit 0", "--pretty"], root);
    assert.equal(result.status, 0, result.stderr);
    const detail = JSON.parse(result.stdout);
    assert.equal(detail.accepted, true);
    assert.equal(detail.isCompleted, false);
    const status = runCli(["node", WRITABLE_NODE, "--pretty"], root);
    const node = JSON.parse(status.stdout);
    assert.notEqual(node.status, "completed");
    assert.equal(node.evidence.at(-1)?.verifiedBy, "agent_submitted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LSE's own build/test health never completes a user's ready-preflight", async () => {
  const root = await makeRoot();
  try {
    // A user case, plus a legacy LSE-shaped "green" evidence bundle on disk
    // (what the removed repository collector used to write).
    const ctxPath = path.join(root, "my-app.json");
    await writeFile(ctxPath, JSON.stringify({ ...FIXTURES.minimal, productId: "my-app", name: "My App" }));
    assert.equal(runCli(["case-create", ctxPath], root).status, 0);
    await mkdir2(path.join(root, "public", "evidence"));
    await writeFile(path.join(root, "public", "evidence", "ready-preflight.json"), JSON.stringify({
      schemaVersion: "ready-preflight-evidence@1", nodeId: "ready-preflight", sourceRevision: "r", collectedAt: "2026-10-10T00:00:00.000Z",
      collector: { name: "launch-state-engine-local-collector", version: "0.1.0" },
      preflight: { command: "npm run fixtures", exitCode: 0, errors: [], warnings: [], dispositions: [] },
      build: { command: "npm run build", exitCode: 0, succeeded: true },
    }));
    // Agent reports LSE's own successful build as evidence and tries to complete.
    assert.equal(runCli(["propose-evidence", "ready-preflight", "build_log", "LSE npm run build", "exit 0"], root).status, 0);
    const refused = runCli(["propose-status", "ready-preflight", "completed"], root);
    assert.equal(refused.status, 2);
    const recompute = runCli(["recompute", "--collect"], root);
    assert.equal(recompute.status, 2);
    assert.match(recompute.stderr, /removed/);

    const node = JSON.parse(runCli(["node", "ready-preflight", "--pretty"], root).stdout);
    assert.equal(node.status, "not_started");
    assert.equal(node.evidence.every((e: any) => e.verifiedBy === "agent_submitted"), true);
    assert.equal(node.evidence.some((e: any) => e.type === "ready-preflight-bundle"), false);
    const status = JSON.parse(runCli(["status", "--pretty"], root).stdout);
    assert.equal(status.summary.completed, 0);
    assert.equal("readyPreflight" in status, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI next and parallel agree: next is dependency-eligible", async () => {
  const root = await makeRoot();
  try {
    // An agent proposes downstream work as waiting; the old rule would make it Next.
    assert.equal(runCli(["propose-status", "prod-published", "waiting"], root).status, 0);
    const next = JSON.parse(runCli(["next", "--pretty"], root).stdout).next;
    assert.notEqual(next.nodeId, "prod-published");
    assert.equal(next.basis, "recorded dependencies satisfied (dependency graph)");
    const guidance = JSON.parse(runCli(["parallel", "--pretty"], root).stdout).guidance;
    assert.equal(guidance.startableNow.some((n: any) => n.nodeId === next.nodeId), true);
    assert.equal(guidance.primary.nodeId, next.nodeId);
    assert.equal(guidance.notStartableYet.some((n: any) => n.nodeId === "prod-published"), true);
    const status = JSON.parse(runCli(["status", "--pretty"], root).stdout);
    assert.deepEqual(status.nextAction, next);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cases created from example fixtures are labelled as examples", async () => {
  const root = await makeRoot();
  try {
    const status = JSON.parse(runCli(["status", "--pretty"], root).stdout);
    assert.equal(status.caseOrigin, "fixture");
    assert.match(status.exampleCase, /fictional example/);
    const ctxPath = path.join(root, "mine.json");
    await writeFile(ctxPath, JSON.stringify({ ...FIXTURES.minimal, productId: "mine", name: "Mine" }));
    assert.equal(runCli(["case-create", ctxPath], root).status, 0);
    const after = JSON.parse(runCli(["status", "--pretty"], root).stdout);
    assert.equal(after.caseOrigin, "created");
    assert.equal("exampleCase" in after, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the shipped ProductContext template creates a case", async () => {
  const root = await makeEmptyRoot();
  try {
    const template = fileURLToPath(new URL("../examples/product-context.json", import.meta.url));
    const created = runCli(["case-create", template, "--pretty"], root);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(JSON.parse(created.stdout).switched, true);
    const next = JSON.parse(runCli(["next", "--pretty"], root).stdout).next;
    // The template leaves facts unknown: the agent must stop and ask.
    assert.equal(next.kind, "product_decision");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context-set rejects null values and unknown fields, keeps unknown tri-state", async () => {
  const root = await makeRoot();
  try {
    const writeContext = (name: string, mutate: (ctx: ProductContext) => unknown) =>
      writeFile(path.join(root, name), JSON.stringify(mutate(FIXTURES.productivity)));

    await writeContext("ctx-null.json", ctx => ({ ...ctx, imageUpload: null }));
    assert.equal(runCli(["context-set", "ctx-null.json"], root).status, 2);

    await writeContext("ctx-extra.json", ctx => ({ ...ctx, hackerField: true }));
    assert.equal(runCli(["context-set", "ctx-extra.json"], root).status, 2);

    await writeContext("ctx-unknown.json", ctx => ({ ...ctx, hasUserAccounts: "unknown" }));
    const accepted = runCli(["context-set", "ctx-unknown.json", "--pretty"], root);
    assert.equal(accepted.status, 0, accepted.stderr);

    const context = JSON.parse(runCli(["context", "--pretty"], root).stdout);
    assert.deepEqual(context.unknownFields, ["hasUserAccounts"]);
    const status = JSON.parse(runCli(["status", "--pretty"], root).stdout);
    assert.equal(status.summary.undeterminedCount > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function mkdir2(dir: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
}

test("case-create adds an isolated case without touching the active one", async () => {
  const root = await makeRoot();
  try {
    // active case is the example case; patch it so we can prove isolation.
    assert.equal(runCli(["propose-status", WRITABLE_NODE, "waiting"], root).status, 0);

    const ctxPath = path.join(root, "other-product.json");
    await writeFile(ctxPath, JSON.stringify({ ...FIXTURES.productivity, productId: "other-product", name: "Other Product", cloudData: false, externalProcessing: true, hasUserAccounts: "unknown" }));
    const created = JSON.parse(runCli(["case-create", ctxPath, "--pretty"], root).stdout);
    assert.equal(created.created, true);
    assert.equal(created.switched, true);
    assert.equal(created.caseId, "other-product:wechat-launch");

    // The other product is active now and must NOT see the example case's proposal.
    const otherDetail = JSON.parse(runCli(["node", WRITABLE_NODE, "--pretty"], root).stdout);
    assert.equal(otherDetail.status, "not_started");
    assert.equal(otherDetail.evidence.length, 0);

    // externalProcessing expresses local-first data + external AI processing:
    // privacy node applies via external processing even though cloudData is false.
    // privacy-declaration must be IN the flow; backend-production must not be.
    const flow = JSON.parse(runCli(["flow", "--pretty"], root).stdout);
    const flowNodeIds = flow.flow.stages.flatMap((s: any) => s.nodes.map((n: any) => n.id));
    assert.equal(flowNodeIds.includes("privacy-declaration"), true);
    assert.equal(flowNodeIds.includes("backend-production"), false);

    // duplicate creation is refused
    const again = runCli(["case-create", ctxPath], root);
    assert.equal(again.status, 2, again.stdout);
    assert.match(again.stderr, /already exists/);

    // cross-product context-set is refused (the dogfood overwrite bug)
    await writeFile(ctxPath, JSON.stringify({ ...FIXTURES.productivity, productId: "example-productivity-app" }));
    const refused = runCli(["context-set", ctxPath], root);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /Product mismatch/);

    // switching back restores the example case's proposal; the other product keeps its own state
    const back = JSON.parse(runCli(["case-switch", EXAMPLE_CASE, "--pretty"], root).stdout);
    assert.equal(back.switched, true);
    const exampleStatus = JSON.parse(runCli(["node", WRITABLE_NODE, "--pretty"], root).stdout);
    assert.equal(exampleStatus.status, "waiting");

    const listing = JSON.parse(runCli(["cases", "--pretty"], root).stdout);
    assert.equal(listing.cases.length, 2);
    const exampleEntry = listing.cases.find((c: any) => c.caseId === EXAMPLE_CASE);
    const otherEntry = listing.cases.find((c: any) => c.caseId === "other-product:wechat-launch");
    assert.equal(exampleEntry.active, true);
    assert.equal(otherEntry.active, false);
    assert.equal(exampleEntry.pendingProposals, 1);
    assert.equal(otherEntry.pendingProposals, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same-product context updates do not create a new case and keep the patch", async () => {
  const root = await makeRoot();
  try {
    assert.equal(runCli(["propose-status", WRITABLE_NODE, "waiting"], root).status, 0);
    const ctxPath = path.join(root, "facts.json");
    await writeFile(ctxPath, JSON.stringify({ ...FIXTURES.productivity, imageUpload: "unknown" }));
    assert.equal(runCli(["context-set", ctxPath], root).status, 0);
    const listing = JSON.parse(runCli(["cases", "--pretty"], root).stdout);
    assert.equal(listing.cases.length, 1);
    const detail = JSON.parse(runCli(["node", WRITABLE_NODE, "--pretty"], root).stdout);
    assert.equal(detail.status, "waiting");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reset refuses cross-product fixtures and preserves the active case identity", async () => {
  const root = await makeRoot();
  try {
    const ctxPath = path.join(root, "other-product.json");
    await writeFile(ctxPath, JSON.stringify({ ...FIXTURES.productivity, productId: "other-product", name: "Other Product" }));
    assert.equal(runCli(["case-create", ctxPath], root).status, 0);
    const refused = runCli(["reset", "--fixture", "productivity"], root);
    assert.equal(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /case-create/);
    const plain = JSON.parse(runCli(["reset", "--pretty"], root).stdout);
    assert.equal(plain.preservedContext, "other-product");
    const store = await readStore(root);
    assert.deepEqual(store.patch, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("product decision handoff emits structured stop_and_ask semantics", async () => {
  const root = await makeRoot();
  try {
    const ctxPath = path.join(root, "ctx.json");
    await writeFile(ctxPath, JSON.stringify({ ...FIXTURES.productivity, hasUserAccounts: "unknown" }));
    assert.equal(runCli(["context-set", ctxPath], root).status, 0);
    const next = JSON.parse(runCli(["next", "--pretty"], root).stdout);
    assert.equal(next.next.kind, "product_decision");
    assert.equal(next.next.owner, "user");
    assert.equal(next.next.requiresUserDecision, true);
    assert.equal(next.next.policy, "stop_and_ask");
    assert.equal(next.next.mayContinue.existingFlowNodes, true);
    assert.match(next.next.resume, /context-set/);
    const undetermined = JSON.parse(runCli(["undetermined", "--pretty"], root).stdout);
    assert.equal(undetermined.policy, "stop_and_ask");
    assert.equal(undetermined.items[0].requiresUserDecision, true);
    const node = JSON.parse(runCli(["node", "backend-user-identity", "--pretty"], root).stdout);
    assert.equal(node.location, "undetermined");
    assert.equal(node.requiresUserDecision, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-discovered observations cannot alter applicability (provenance discipline)", async () => {
  const root = await makeRoot();
  try {
    const before = JSON.parse(runCli(["flow", "--pretty"], root).stdout);
    const beforeIds = before.flow.stages.flatMap((s: any) => s.nodes.map((n: any) => n.id)).sort();
    const result = runCli(["propose-evidence", WRITABLE_NODE, "field_observation", "Agent discovered platform constraint", "ICP filing required for AI feature"], root);
    assert.equal(result.status, 0, result.stderr);
    const after = JSON.parse(runCli(["flow", "--pretty"], root).stdout);
    const afterIds = after.flow.stages.flatMap((s: any) => s.nodes.map((n: any) => n.id)).sort();
    // The observation is recorded as agent_submitted evidence only — the
    // applicable flow is untouched.
    assert.deepEqual(afterIds, beforeIds);
    const detail = JSON.parse(runCli(["node", WRITABLE_NODE, "--pretty"], root).stdout);
    const observation = detail.evidence.at(-1);
    assert.equal(observation.verifiedBy, "agent_submitted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("status reports the rule coverage boundary and parallel reports dependency-derived guidance", async () => {
  const root = await makeRoot();
  try {
    const status = JSON.parse(runCli(["status", "--pretty"], root).stdout);
    assert.equal(status.coverage?.schemaVersion, "registry-coverage@1");
    assert.equal(status.coverage?.level, "partial");

    const parallel = JSON.parse(runCli(["parallel", "--pretty"], root).stdout);
    assert.equal(parallel.guidance.schemaVersion, "parallel-guidance@1");
    const stages = new Set(parallel.guidance.startableNow.map((n: any) => n.stageId));
    assert.equal(stages.size >= 2, true);
    const startable = parallel.guidance.startableNow.map((n: any) => n.nodeId);
    // Real dependency chain must never appear as startable.
    assert.equal(startable.includes("prod-verified"), false);
    assert.equal(startable.includes("prod-published"), false);
    const blocked = runCli(["propose-blocker", "filing-complete", "备案审核中", "管局审核周期内等待", "等待结果；期间可继续开发"], root);
    assert.equal(blocked.status, 0, blocked.stderr);
    const parallelWhileWaiting = JSON.parse(runCli(["parallel", "--pretty"], root).stdout);
    assert.equal(parallelWhileWaiting.guidance.waiting.some((w: any) => w.nodeId === "filing-complete"), true);
    assert.equal(parallelWhileWaiting.guidance.startableNow.some((n: any) => n.nodeId === "migration-core-path"), true);
    assert.equal(parallelWhileWaiting.guidance.canRunInParallel, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
