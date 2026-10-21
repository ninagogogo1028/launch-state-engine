export type Status = "completed" | "waiting" | "blocked" | "not_started";
export type Actor = "AUTO" | "AI_OR_HUMAN" | "HUMAN";
export type FactValue = boolean | "unknown";
export type RequirementKind = "external_requirement" | "conditional_requirement" | "product_decision" | "launch_process" | "experience_recommendation";
export type MonetizationModel = "free" | "one_time" | "subscription" | "usage_based" | "commission" | "advertising" | "mixed" | "unknown";
export type TransactionObject = "none" | "physical_goods" | "offline_service" | "virtual_goods" | "donation" | "unknown";
export type PaymentChannel = "none" | "wechat_pay" | "wechat_virtual_payment" | "external_or_offline" | "multiple" | "unknown";

export type ProductContext = {
  schemaVersion: "1.1";
  productId: string;
  name: string;
  subjectType: "personal" | "individual_business" | "enterprise" | "organization" | "unknown";
  category: "local_tool" | "productivity" | "community" | "content" | "commerce" | "service" | "education" | "game" | "other" | "unknown";
  existingProduct: FactValue;
  hasWechatAccount: FactValue;
  hasUserAccounts: FactValue;
  // cloudData means first-party cloud persistence / backend state (servers,
  // databases, cloud functions operated for the product). It does NOT cover
  // sending user content to an external service for processing.
  cloudData: FactValue;
  // Whether user content / personal data is sent to an external service for
  // processing (first-party edge functions and third-party APIs alike).
  // Optional at runtime: older contexts without the field read as "unknown",
  // never as false.
  externalProcessing?: FactValue;
  payment: "none" | "physical_goods" | "virtual_goods" | "unknown";
  // V0.1.1 payment semantics. Optional so existing 1.1 Launch Cases and CLI
  // payloads remain readable without rewriting user-owned progress.
  monetizationModel?: MonetizationModel;
  transactionObject?: TransactionObject;
  paymentChannel?: PaymentChannel;
  permanentEntitlement: FactValue;
  reminder: FactValue;
  files: FactValue;
  imageUpload: FactValue;
  clipboard: FactValue;
  ugcText: FactValue;
  ugcImages: FactValue;
  location: FactValue;
};

export type Condition =
  | { field: keyof ProductContext; op: "eq" | "neq"; value: unknown }
  | { field: keyof ProductContext; op: "truthy" }
  | { op: "any"; conditions: Condition[] }
  | { op: "all"; conditions: Condition[] };

export type Rule = {
  id: string;
  title: string;
  authority: "official" | "field_experience";
  requirementKind: RequirementKind;
  nodeRequirementKinds?: Partial<Record<string, RequirementKind>>;
  when: Condition;
  includeNodeIds?: string[];
  excludeNodeIds?: string[];
  addFieldNotes?: { nodeId: string; note: string; caseId?: string }[];
  sourceIds: string[];
  lastVerifiedAt: string;
  explanation: string;
  decision?: { fields:(keyof ProductContext)[]; prompt:string; impact:string };
};

export type Source = { id:string; title:string; url:string; publisher:string; authority:"official"|"field_experience"; lastVerifiedAt:string };
// requirement = what to do; where = where it is done; why = why the step
// exists. nextAction is the one-line imperative shown as the next step.
export type NodeTemplate = { id:string; stageId:string; title:string; requirement:string; where?:string; why?:string; actorType:Actor; workProfile:{complexity:string;volume:string;risk:string}; nextAction:string; exitCriteria:string[]; sourceIds:string[]; fieldNotes:string[]; dependencies?:string[] };

// Honest statement of what the Rule Registry has actually verified. "partial"
// is the expected steady state: unmatched rules never imply the absence of
// requirements, and an excluded rule ("confirmed not applicable") is a
// different thing from a rule family the registry has never covered.
export type RegistryCoverage = {
  schemaVersion: "registry-coverage@1";
  level: "verified" | "partial" | "unverified";
  // One plain-language sentence for primary UIs; boundary holds the detail.
  summary: string;
  verifiedFor: string[];
  boundary: string;
};
export type Evidence = { type:string; label:string; value:string; verifiedBy?:string };
export type Blocker = { summary:string; diagnosis:string; resolution:string };
export type DecisionPrompt = { owner:"user"; fields:(keyof ProductContext)[]; prompt:string; impact:string };
export type FlowNode = NodeTemplate & { status:Status; dependencies:string[]; applicability:{included:boolean;matchedRuleIds:string[];why:string[];requirementKind:RequirementKind;triggeredBy:string[]}|string; requirementKind:RequirementKind; whyThisApplies:string; officialSources:Source[]; evidence:Evidence[]; blocker:Blocker|null };
export type FlowDecision = { nodeId:string; title:string; outcome:"included"|"excluded"|"undetermined"; requirementKind:RequirementKind; matchedRuleIds:string[]; why:string[]; decision:DecisionPrompt|null };
export type Flow = { schemaVersion:"1.1"; flowId:string; project:{name:string;caseId:string;target:string}; productContext:ProductContext; stages:{id:string;index:number;title:string;purpose:string;nodes:FlowNode[]}[]; excludedCapabilities:FlowDecision[]; undeterminedCapabilities:FlowDecision[]; ruleEvaluation:{registryVersion:string;generatedAt:string;matchedRuleIds:string[];undeterminedRuleIds:string[];coverage?:RegistryCoverage} };
