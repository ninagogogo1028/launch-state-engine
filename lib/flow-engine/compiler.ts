import { NODE_CATALOG, STAGES } from "./catalog.ts";
import { REGISTRY_COVERAGE, RULES, RULE_REGISTRY_VERSION } from "./rules.ts";
import { sourceById } from "./sources.ts";
import type { Condition, Flow, FlowDecision, ProductContext, RequirementKind, Rule } from "./types.ts";

export type ConditionResult = "matched" | "not_matched" | "undetermined";

function readField(context: ProductContext, field: keyof ProductContext) { return context[field]; }
function isUnknown(value:unknown) { return value === "unknown"; }

export function evaluateCondition(condition:Condition, context:ProductContext):ConditionResult {
  if (condition.op === "all") {
    const results=condition.conditions.map(item=>evaluateCondition(item,context));
    if (results.includes("not_matched")) return "not_matched";
    return results.includes("undetermined") ? "undetermined" : "matched";
  }
  if (condition.op === "any") {
    const results=condition.conditions.map(item=>evaluateCondition(item,context));
    if (results.includes("matched")) return "matched";
    return results.includes("undetermined") ? "undetermined" : "not_matched";
  }
  const actual=readField(context,condition.field);
  // A missing fact is an unknown fact: it must never silently compare as false.
  if (actual === undefined || isUnknown(actual)) return "undetermined";
  if (condition.op === "truthy") return actual === true ? "matched" : "not_matched";
  const matched=actual === condition.value;
  return (condition.op === "eq" ? matched : !matched) ? "matched" : "not_matched";
}

export function matches(condition:Condition, context:ProductContext):boolean {
  return evaluateCondition(condition,context) === "matched";
}

// Every legal ProductContext field. Writes with any other field are rejected.
export const PRODUCT_CONTEXT_FIELDS:(keyof ProductContext)[]=["schemaVersion","productId","name","subjectType","category","existingProduct","hasWechatAccount","hasUserAccounts","cloudData","externalProcessing","payment","monetizationModel","transactionObject","paymentChannel","permanentEntitlement","reminder","files","imageUpload","clipboard","ugcText","ugcImages","location"];
const FACT_FIELDS:(keyof ProductContext)[]=["existingProduct","hasWechatAccount","hasUserAccounts","cloudData","permanentEntitlement","reminder","files","imageUpload","clipboard","ugcText","ugcImages","location"];
export function validateProductContext(context:ProductContext) {
  if (context.schemaVersion !== "1.1") throw new Error("Unsupported Product Context schema; expected 1.1");
  for (const field of FACT_FIELDS) if (![true,false,"unknown"].includes(context[field] as boolean|string)) throw new Error(`Invalid tri-state value for ${field}`);
  // externalProcessing is optional so older contexts stay readable; when
  // present it must still be a legal tri-state value.
  if (context.externalProcessing !== undefined && ![true,false,"unknown"].includes(context.externalProcessing)) throw new Error("Invalid tri-state value for externalProcessing");
  if (!["personal","individual_business","enterprise","organization","unknown"].includes(context.subjectType)) throw new Error("Invalid subjectType");
  if (!["local_tool","productivity","community","content","commerce","service","education","game","other","unknown"].includes(context.category)) throw new Error("Invalid category");
  if (!["none","physical_goods","virtual_goods","unknown"].includes(context.payment)) throw new Error("Invalid payment");
  if (context.monetizationModel !== undefined && !["free","one_time","subscription","usage_based","commission","advertising","mixed","unknown"].includes(context.monetizationModel)) throw new Error("Invalid monetizationModel");
  if (context.transactionObject !== undefined && !["none","physical_goods","offline_service","virtual_goods","donation","unknown"].includes(context.transactionObject)) throw new Error("Invalid transactionObject");
  if (context.paymentChannel !== undefined && !["none","wechat_pay","wechat_virtual_payment","external_or_offline","multiple","unknown"].includes(context.paymentChannel)) throw new Error("Invalid paymentChannel");
}

// Compatibility projection only: this never writes an existing Launch Case.
// Old `payment` values acquire the minimum equivalent V0.1.1 meaning at read
// time; new fields remain independent once a user has answered them.
export function normalizeProductContext(context:ProductContext):ProductContext {
  validateProductContext(context);
  const legacy=context.payment;
  return {
    ...context,
    monetizationModel:context.monetizationModel??(legacy==="none"?"free":legacy==="unknown"?"unknown":context.permanentEntitlement===true?"one_time":"unknown"),
    transactionObject:context.transactionObject??(legacy==="none"?"none":legacy==="physical_goods"?"physical_goods":legacy==="virtual_goods"?"virtual_goods":"unknown"),
    paymentChannel:context.paymentChannel??(legacy==="none"?"none":legacy==="virtual_goods"?"wechat_virtual_payment":"unknown"),
  };
}

function decisionFor(rule:Rule) { return rule.decision ? {owner:"user" as const,...rule.decision} : null; }
function triggerSummary(rule:Rule,context:ProductContext) { return rule.decision?.fields.map(field=>`${String(field)}=${String(context[field])}`)??[]; }
function nodeKind(rules:Rule[],nodeId:string):RequirementKind {
  const override=rules.map(rule=>rule.nodeRequirementKinds?.[nodeId]).find(Boolean);
  return override??(rules.some(rule=>rule.requirementKind==="conditional_requirement")?"conditional_requirement":"external_requirement");
}

export function compileFlow(context:ProductContext,rules:Rule[]=RULES):Flow {
  const normalized=normalizeProductContext(context);
  const evaluated=new Map(rules.map(rule=>[rule.id,evaluateCondition(rule.when,normalized)]));
  const matched=rules.filter(rule=>evaluated.get(rule.id)==="matched");
  const included=new Map<string,Rule[]>();
  const officialRules=rules.filter(rule=>rule.authority==="official");
  const conditionalNodeIds=new Set(officialRules.flatMap(rule=>[...(rule.includeNodeIds??[]),...(rule.excludeNodeIds??[])]));
  for (const rule of matched.filter(rule=>rule.authority==="official")) for (const nodeId of rule.includeNodeIds??[]) included.set(nodeId,[...(included.get(nodeId)??[]),rule]);

  const decisions:FlowDecision[]=[];
  for (const template of NODE_CATALOG) {
    const matchedRules=included.get(template.id)??[];
    if (matchedRules.length) {
      decisions.push({nodeId:template.id,title:template.title,outcome:"included",requirementKind:nodeKind(matchedRules,template.id),matchedRuleIds:matchedRules.map(rule=>rule.id),why:matchedRules.map(rule=>rule.explanation),decision:null});
      continue;
    }
    if (!conditionalNodeIds.has(template.id)) continue;
    const controlling=officialRules.filter(rule=>(rule.includeNodeIds??[]).includes(template.id)||(rule.excludeNodeIds??[]).includes(template.id));
    const undetermined=controlling.filter(rule=>evaluated.get(rule.id)==="undetermined");
    if (undetermined.length) {
      decisions.push({nodeId:template.id,title:template.title,outcome:"undetermined",requirementKind:"conditional_requirement",matchedRuleIds:undetermined.map(rule=>rule.id),why:undetermined.map(rule=>`尚未确定：${rule.decision?.prompt??rule.title}`),decision:decisionFor(undetermined[0])});
    } else {
      decisions.push({nodeId:template.id,title:template.title,outcome:"excluded",requirementKind:"conditional_requirement",matchedRuleIds:controlling.map(rule=>rule.id),why:[exclusionReason(template.id,normalized)],decision:decisionFor(controlling[0])});
    }
  }

  const includedDecisions=new Map(decisions.filter(item=>item.outcome==="included").map(item=>[item.nodeId,item]));
  const stages=STAGES.map(stage=>({...stage,nodes:NODE_CATALOG.filter(template=>template.stageId===stage.id&&includedDecisions.has(template.id)).map(template=>{
    const decision=includedDecisions.get(template.id)!;
    const matchedRules=decision.matchedRuleIds.map(id=>rules.find(rule=>rule.id===id)).filter((rule):rule is Rule=>Boolean(rule));
    const fieldNotes=matched.flatMap(rule=>(rule.addFieldNotes??[]).filter(note=>note.nodeId===template.id).map(note=>note.note));
    const triggeredBy=matchedRules.flatMap(rule=>triggerSummary(rule,normalized));
    return {...template,status:"not_started" as const,dependencies:template.dependencies??[],requirementKind:decision.requirementKind,applicability:{included:true,matchedRuleIds:decision.matchedRuleIds,why:decision.why,requirementKind:decision.requirementKind,triggeredBy},whyThisApplies:decision.why.join(" "),officialSources:template.sourceIds.map(id=>sourceById[id]).filter(source=>source?.authority==="official"),fieldNotes:[...template.fieldNotes,...fieldNotes],evidence:[],blocker:null};
  })})).filter(stage=>stage.nodes.length>0);

  return {schemaVersion:"1.1",flowId:`wechat-launch-${normalized.productId}`,project:{name:`${normalized.name} → 微信小程序`,caseId:normalized.productId,target:"Production Live + Searchable + Core Path Verified"},productContext:normalized,stages,excludedCapabilities:decisions.filter(item=>item.outcome==="excluded"),undeterminedCapabilities:decisions.filter(item=>item.outcome==="undetermined"),ruleEvaluation:{registryVersion:RULE_REGISTRY_VERSION,generatedAt:new Date().toISOString(),matchedRuleIds:matched.map(rule=>rule.id),undeterminedRuleIds:rules.filter(rule=>evaluated.get(rule.id)==="undetermined").map(rule=>rule.id),coverage:REGISTRY_COVERAGE}};
}

function exclusionReason(nodeId:string,c:ProductContext) {
  const reasons:Record<string,string>={
    "backend-user-identity":"已确认首版不要求用户登录，因此不展开用户身份与会话节点。",
    "backend-production":"已确认首版不读写云端数据，因此不展开生产后端节点。",
    "privacy-declaration":"已确认首版不包含账号、文件、图片、剪切板或位置能力，也未把用户内容发送到外部服务处理；如产品事实变化应重新生成 Flow。",
    "cap-reminder":"已确认首版不发提醒，因此订阅消息路径不适用。",
    "cap-files":"已确认首版不选择文件或图片，因此文件/图片隐私路径不适用。",
    "cap-clipboard":"已确认首版不使用剪切板，因此剪切板隐私路径不适用。",
    "cap-location":"已确认首版不使用位置信息，因此位置隐私路径不适用。",
    "cap-virtual-payment":c.transactionObject==="physical_goods"?"已确认首版交易对象是实物商品，因此不进入微信虚拟支付路径；普通小程序支付的完整要求尚不在当前 Registry 覆盖范围内。":c.transactionObject==="offline_service"?"已确认首版交易对象是线下或到店服务，因此不进入微信虚拟支付路径；相关普通支付要求尚不在当前 Registry 覆盖范围内。":"已确认首版不交易虚拟商品、数字内容或数字权益，因此微信虚拟支付路径不适用。",
    "cap-ugc-governance":"已确认首版不允许用户发布文本或图片，因此不展开 UGC 治理节点。",
    "cap-content-security":"已确认微信首版没有 UGC 文本或图片，因此不展开用户内容安全节点。"
  };
  return reasons[nodeId]??"相关产品事实已明确为不适用。";
}
