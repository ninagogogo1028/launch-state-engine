import test from "node:test";
import assert from "node:assert/strict";
import { compileFlow, evaluateCondition } from "../lib/flow-engine/compiler.ts";
import { FIXTURES } from "../lib/flow-engine/fixtures.ts";
import type { ProductContext } from "../lib/flow-engine/types.ts";

const base:ProductContext={schemaVersion:"1.1",productId:"unknown-test",name:"Unknown test",subjectType:"unknown",category:"productivity",existingProduct:true,hasWechatAccount:"unknown",hasUserAccounts:false,cloudData:false,payment:"unknown",permanentEntitlement:"unknown",reminder:"unknown",files:false,imageUpload:false,clipboard:false,ugcText:false,ugcImages:false,location:"unknown"};

test("unknown is a third condition result, not false",()=>{
  assert.equal(evaluateCondition({field:"reminder",op:"truthy"},base),"undetermined");
  assert.equal(evaluateCondition({field:"hasUserAccounts",op:"truthy"},base),"not_matched");
});

test("unknown applicability becomes undetermined and never receives a false exclusion reason",()=>{
  const flow=compileFlow(base);
  const reminder=flow.undeterminedCapabilities.find(item=>item.nodeId==="cap-reminder");
  assert.ok(reminder);
  assert.equal(flow.excludedCapabilities.some(item=>item.nodeId==="cap-reminder"),false);
  assert.match(reminder.why.join(" "),/尚未确定/);
  assert.equal(reminder.decision?.owner,"user");
});

test("confirmed no remains excluded with explicit confirmed wording",()=>{
  const flow=compileFlow({...base,reminder:false});
  const reminder=flow.excludedCapabilities.find(item=>item.nodeId==="cap-reminder");
  assert.ok(reminder);
  assert.match(reminder.why.join(" "),/已确认/);
});

test("official baseline and triggered conditional requirements remain distinguishable",()=>{
  const flow=compileFlow({...base,files:true});
  const nodes=flow.stages.flatMap(stage=>stage.nodes);
  assert.equal(nodes.find(node=>node.id==="filing-complete")?.requirementKind,"external_requirement");
  // Confirming product facts is launch work; individual facts may be product decisions.
  assert.equal(nodes.find(node=>node.id==="assess-context")?.requirementKind,"launch_process");
  assert.equal(nodes.find(node=>node.id==="ready-preflight")?.requirementKind,"launch_process");
  assert.equal(nodes.find(node=>node.id==="cap-files")?.requirementKind,"conditional_requirement");
  assert.deepEqual((nodes.find(node=>node.id==="cap-files")?.applicability as {triggeredBy:string[]}).triggeredBy,["files=true","imageUpload=false"]);
});

test("field experience stays a recommendation and cannot create or upgrade a requirement",()=>{
  const flow=compileFlow(FIXTURES.productivity);
  const reminder=flow.stages.flatMap(stage=>stage.nodes).find(node=>node.id==="cap-reminder");
  assert.equal(reminder?.requirementKind,"conditional_requirement");
  assert.ok(reminder?.fieldNotes.some(note=>note.startsWith("实践经验")));
  assert.equal(reminder?.applicability && typeof reminder.applicability!=="string" ? reminder.applicability.matchedRuleIds.includes("field.subscribe-message-end-to-end") : true,false);
});

test("invalid null no longer silently compiles as false",()=>{
  assert.throws(()=>compileFlow({...base,reminder:null} as unknown as ProductContext),/Invalid tri-state value/);
});

test("legacy payment contexts are projected safely without rewriting their schema",()=>{
  const legacyVirtual=compileFlow({...base,payment:"virtual_goods",permanentEntitlement:true});
  assert.equal(legacyVirtual.productContext.transactionObject,"virtual_goods");
  assert.equal(legacyVirtual.productContext.monetizationModel,"one_time");
  assert.equal(legacyVirtual.productContext.paymentChannel,"wechat_virtual_payment");
  assert.ok(legacyVirtual.stages.flatMap(stage=>stage.nodes).some(node=>node.id==="cap-virtual-payment"));
});

test("charging is not synonymous with virtual payment",()=>{
  const physical=compileFlow({...base,payment:"physical_goods",monetizationModel:"one_time",transactionObject:"physical_goods",paymentChannel:"wechat_pay"});
  assert.equal(physical.stages.flatMap(stage=>stage.nodes).some(node=>node.id==="cap-virtual-payment"),false);
  assert.match(physical.excludedCapabilities.find(item=>item.nodeId==="cap-virtual-payment")?.why.join(" ")??"",/实物商品/);
  assert.match(physical.ruleEvaluation.coverage?.boundary??"",/普通小程序支付/);
});

test("virtual payment applicability comes from the transaction object, not a generic charged flag",()=>{
  const virtual=compileFlow({...base,payment:"unknown",monetizationModel:"subscription",transactionObject:"virtual_goods",paymentChannel:"unknown"});
  const node=virtual.stages.flatMap(stage=>stage.nodes).find(node=>node.id==="cap-virtual-payment");
  assert.ok(node);
  assert.match(node.whyThisApplies,/虚拟商品/);
});

test("three dogfood contexts preserve facts and expose unknown paths",()=>{
  const contexts:ProductContext[]=[
    {...base,productId:"dogfood-it-tools",name:"IT-Tools",hasUserAccounts:false,cloudData:false,files:true,imageUpload:false,clipboard:true,ugcText:false,ugcImages:false},
    {...base,productId:"dogfood-linkding",name:"linkding",hasUserAccounts:true,cloudData:true,files:true,imageUpload:true,clipboard:true,ugcText:true,ugcImages:"unknown"},
    {...base,productId:"dogfood-picsur",name:"Picsur",category:"content",hasUserAccounts:true,cloudData:true,files:false,imageUpload:true,clipboard:true,ugcText:false,ugcImages:true}
  ];
  const [itTools,linkding,picsur]=contexts.map(context=>compileFlow(context));
  assert.ok(itTools.excludedCapabilities.some(item=>item.nodeId==="backend-production"));
  assert.ok(linkding.stages.flatMap(stage=>stage.nodes).some(node=>node.id==="backend-production"));
  assert.ok(picsur.stages.flatMap(stage=>stage.nodes).some(node=>node.id==="cap-content-security"));
  for (const flow of [itTools,linkding,picsur]) {
    assert.deepEqual(flow.undeterminedCapabilities.map(item=>item.nodeId).sort(),["cap-location","cap-reminder","cap-virtual-payment"]);
  }
});
