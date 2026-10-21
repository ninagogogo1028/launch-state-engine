import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleTruthRequest, truthView } from "../lib/launch-truth-api.ts";
import { createLaunchCase, listLaunchCases, loadActiveStore } from "../lib/launch-store-file.ts";
import { FIXTURES } from "../lib/flow-engine/fixtures.ts";

const NODE = "migration-core-path";

async function withEmptyRoot(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "lse-api-test-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

// One active Launch Case created from the fictional productivity fixture.
function withRoot(fn: (root: string) => Promise<void>) {
  return withEmptyRoot(async root => {
    await createLaunchCase({ ...FIXTURES.productivity }, root, { origin: "fixture" });
    await fn(root);
  });
}

async function activeStore(root: string) {
  const store = await loadActiveStore(root);
  assert.ok(store);
  return store;
}

const statusOf = (body: any, nodeId: string) => body.flow.stages.flatMap((s: any) => s.nodes).find((n: any) => n.id === nodeId)?.status;

test("agent channel (propose) never writes humanStatuses and never completes", () => withRoot(async root => {
  const refused = await handleTruthRequest(root, { action: "propose", nodePatches: { [NODE]: { status: "completed" } } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.ok ? null : refused.body.kind, "proposal_rejected");

  const smuggled = await handleTruthRequest(root, { action: "propose", nodePatches: { [NODE]: { status: "waiting" } }, humanStatuses: { [NODE]: "completed" } });
  assert.equal(smuggled.status, 200);
  const store = await activeStore(root);
  assert.equal(store.patch.humanStatuses, undefined);
  assert.equal(store.patch.nodePatches?.[NODE]?.status, "waiting");
}));

test("agent proposals cannot override a human confirmation", () => withRoot(async root => {
  const human = await handleTruthRequest(root, { action: "status", nodeId: NODE, status: "completed" });
  assert.equal(human.status, 200);
  const proposal = await handleTruthRequest(root, { action: "propose", nodePatches: { [NODE]: { status: "not_started" } } });
  assert.equal(proposal.status, 200);
  assert.equal(statusOf(proposal.body, NODE), "completed");
  const store = await activeStore(root);
  assert.equal(store.patch.humanStatuses?.[NODE], "completed");
}));

test("human channel rejects unknown nodes and illegal statuses", () => withRoot(async root => {
  assert.equal((await handleTruthRequest(root, { action: "status", nodeId: "no-such-node", status: "completed" })).status, 400);
  assert.equal((await handleTruthRequest(root, { action: "status", nodeId: NODE, status: "done" })).status, 400);
}));

test("a different product is reported as product_mismatch, not a write failure", () => withRoot(async root => {
  const response = await handleTruthRequest(root, { action: "context", productContext: { ...FIXTURES.minimal, productId: "my-app", name: "My App" } });
  assert.equal(response.status, 409);
  assert.equal(response.body.ok ? null : response.body.kind, "product_mismatch");
  assert.match(response.body.ok ? "" : response.body.hint ?? "", /case-create/);
  const store = await activeStore(root);
  assert.equal(store.productContext.productId, FIXTURES.productivity.productId);
}));

test("truth view exposes the case identity and origin", () => withRoot(async root => {
  const response = await handleTruthRequest(root, { action: "reset" });
  assert.equal(response.status, 200);
  assert.ok(response.body.ok);
  assert.equal(response.body.store?.caseOrigin, "fixture");
  assert.equal(response.body.store?.contextId, "example-productivity-app:wechat-launch");
  assert.deepEqual(response.body.cases.map(c => c.caseId), ["example-productivity-app:wechat-launch"]);
}));

test("a fresh checkout is an empty state; writes need a case first", () => withEmptyRoot(async root => {
  const reset = await handleTruthRequest(root, { action: "reset" });
  assert.equal(reset.status, 409);
  assert.equal(reset.body.ok ? null : reset.body.kind, "no_active_case");
  assert.equal(await loadActiveStore(root), null);
}));

test("first-use lifecycle works without seeded products and survives reopen",()=>withEmptyRoot(async root=>{
  const fresh=await truthView(root);
  assert.equal(fresh.store,null);
  assert.equal(fresh.flow,null);
  assert.deepEqual(fresh.cases,[]);
  const context={...FIXTURES.minimal,productId:"first-product",name:"First Product"};
  const created=await handleTruthRequest(root,{action:"create",productContext:context});
  assert.equal(created.status,200);
  assert.equal(created.body.ok&&created.body.flow?.productContext.name,"First Product");
  assert.ok(created.body.ok&&created.body.flow?.stages.flatMap(stage=>stage.nodes).length);
  await handleTruthRequest(root,{action:"status",nodeId:"assess-context",status:"completed"});
  const reopened=await truthView(root);
  assert.equal(reopened.store?.contextId,"first-product:wechat-launch");
  assert.equal(reopened.flow?.stages.flatMap(stage=>stage.nodes).find(node=>node.id==="assess-context")?.status,"completed");
}));

test("deleting the active product selects another case and preserves its progress",()=>withEmptyRoot(async root=>{
  const first={...FIXTURES.minimal,productId:"keep-me",name:"Keep Me"};
  const second={...FIXTURES.productivity,productId:"delete-me",name:"Delete Me"};
  await handleTruthRequest(root,{action:"create",productContext:first});
  await handleTruthRequest(root,{action:"status",nodeId:"assess-context",status:"completed"});
  await handleTruthRequest(root,{action:"create",productContext:second});
  await handleTruthRequest(root,{action:"status",nodeId:"migration-core-path",status:"waiting"});
  const deleted=await handleTruthRequest(root,{action:"delete",caseId:"delete-me:wechat-launch"});
  assert.equal(deleted.status,200);
  assert.equal(deleted.body.ok&&deleted.body.store?.contextId,"keep-me:wechat-launch");
  assert.equal(deleted.body.ok&&statusOf(deleted.body,"assess-context"),"completed");
  const listing=await listLaunchCases(root);
  assert.deepEqual(listing.cases.map(item=>item.caseId),["keep-me:wechat-launch"]);
}));

test("deleting the last product returns to empty state and unknown deletion is isolated",()=>withEmptyRoot(async root=>{
  await handleTruthRequest(root,{action:"create",productContext:{...FIXTURES.minimal,productId:"only-product",name:"Only Product"}});
  const missing=await handleTruthRequest(root,{action:"delete",caseId:"not-there:wechat-launch"});
  assert.equal(missing.status,404);
  assert.equal((await loadActiveStore(root))?.contextId,"only-product:wechat-launch");
  const deleted=await handleTruthRequest(root,{action:"delete",caseId:"only-product:wechat-launch"});
  assert.equal(deleted.status,200);
  assert.equal(deleted.body.ok&&deleted.body.store,null);
  assert.equal(deleted.body.ok&&deleted.body.flow,null);
  assert.deepEqual(deleted.body.ok&&deleted.body.cases,[]);
  assert.equal(await loadActiveStore(root),null);
}));

test("the dashboard creates and switches cases through the same functions as the CLI", () => withEmptyRoot(async root => {
  const blank = { ...FIXTURES.minimal, productId: "my-app", name: "My App" };
  const created = await handleTruthRequest(root, { action: "create", productContext: blank });
  assert.equal(created.status, 200);
  assert.ok(created.body.ok);
  assert.equal(created.body.store?.contextId, "my-app:wechat-launch");
  assert.equal(created.body.store?.caseOrigin, "created");

  const duplicate = await handleTruthRequest(root, { action: "create", productContext: blank });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.ok ? null : duplicate.body.kind, "case_exists");

  const second = await handleTruthRequest(root, { action: "create", productContext: { ...blank, productId: "second-app", name: "Second" } });
  assert.equal(second.status, 200);
  assert.equal(second.body.ok && second.body.cases.length, 2);

  // Status written on the second app is not visible after switching back.
  assert.equal((await handleTruthRequest(root, { action: "status", nodeId: "assess-context", status: "completed" })).status, 200);
  const back = await handleTruthRequest(root, { action: "switch", caseId: "my-app:wechat-launch" });
  assert.equal(back.status, 200);
  assert.ok(back.body.ok);
  assert.equal(statusOf(back.body, "assess-context"), "not_started");

  const missing = await handleTruthRequest(root, { action: "switch", caseId: "nope:wechat-launch" });
  assert.equal(missing.status, 404);

  const invalid = await handleTruthRequest(root, { action: "create", productContext: { ...blank, productId: "bad id!" } });
  assert.equal(invalid.status, 400);
}));
