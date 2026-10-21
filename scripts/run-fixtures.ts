import { compileFlow } from "../lib/flow-engine/compiler.ts";
import { FIXTURES } from "../lib/flow-engine/fixtures.ts";

const results = Object.entries(FIXTURES).map(([key, context]) => {
  const flow = compileFlow(context);
  const included = flow.stages.flatMap(stage => stage.nodes.map(node => node.id));
  const excluded = flow.excludedCapabilities.map(node => node.nodeId);
  const undetermined = flow.undeterminedCapabilities.map(node => node.nodeId);
  return {fixture:key,name:context.name,includedCount:included.length,included,excluded,undetermined,matchedRules:flow.ruleEvaluation.matchedRuleIds};
});
if (new Set(results.map(result => result.included.join("|"))).size !== results.length) throw new Error("Fixtures did not produce distinct flows");
console.log(JSON.stringify(results, null, 2));
