"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, CircleDashed, Clock3, Download, ExternalLink, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, Upload, WandSparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { computeParallelGuidance, selectNextAction } from "@/lib/flow-engine/parallel";
import type { Actor, FactValue, Flow, FlowNode, ProductContext, RequirementKind, Status } from "@/lib/flow-engine/types";
import { blankProductContext, buildFlowFromStore, productIdFromName, sanitizeStore } from "@/lib/launch-store";

// ---- Human presentation of engine semantics --------------------------------
// The engine keeps its machine-readable vocabulary (actorType, requirementKind,
// status). These maps are the only place the dashboard translates it into
// plain language; raw values stay available under "更多信息".

const statusMeta:Record<Status,{label:string;className:string;icon:typeof Check}>={completed:{label:"已完成",className:"status-completed",icon:Check},waiting:{label:"进行中",className:"status-waiting",icon:Clock3},blocked:{label:"已阻塞",className:"status-blocked",icon:AlertTriangle},not_started:{label:"未开始",className:"status-not-started",icon:CircleDashed}};

const WHO:Record<Actor,{chip:string;label:string}>={
 HUMAN:{chip:"你本人",label:"需要你本人处理"},
 AI_OR_HUMAN:{chip:"你或开发 Agent",label:"你可以自己完成，也可以让开发 Agent 协助"},
 AUTO:{chip:"开发 Agent + 你复核",label:"适合交给开发 Agent 完成，由你复核结果"},
};

const NATURE:Record<RequirementKind,{label:string;className:string;copy:string}>={
 external_requirement:{label:"微信平台要求",className:"nature-external",copy:"微信对所有小程序上线都有这项要求，不能跳过。"},
 conditional_requirement:{label:"因你的产品功能而需要",className:"nature-conditional",copy:"因为你的产品用到了相关功能，所以需要这一步；如果首版不再使用这些功能，这一步可能就不需要了。"},
 product_decision:{label:"需要你决定",className:"nature-decision",copy:"这一步取决于你对产品的决定，LSE 不会替你决定。"},
 launch_process:{label:"上线准备",className:"nature-process",copy:"这是为了顺利上线、确认可用而需要完成的准备或验证工作，不是微信的硬性规定。"},
 experience_recommendation:{label:"经验建议",className:"nature-experience",copy:"这是实践经验，不是官方要求。"},
};

const BASIC_FACTS:Array<[keyof ProductContext,string,"事实"|"由你决定"]>=[
 ["existingProduct","已经有一个在运行的产品（网页、App 等）","事实"],
 ["hasWechatAccount","已经有微信小程序账号","事实"],
];
const CORE_FACTS:Array<[keyof ProductContext,string,"事实"|"由你决定"]>=[
 ["hasUserAccounts","用户需要先登录或被识别，才能使用核心功能","由你决定"],
 ["cloudData","首版需要在服务器上保存或读取数据","由你决定"],
 ["externalProcessing","首版会把用户内容发送到外部服务处理（例如 AI 接口）","事实"],
 ["reminder","首版会给用户发提醒（订阅消息）","由你决定"],
 ["clipboard","首版会读写剪切板","由你决定"],
 ["location","首版使用位置信息","由你决定"],
];
const CONTENT_FACTS:Array<[keyof ProductContext,string,"事实"|"由你决定"]>=[
 ["files","用户可以选择或上传非图片文件","由你决定"],
 ["imageUpload","用户可以选择或上传图片","由你决定"],
 ["ugcText","用户发布的文字会被其他用户看到","由你决定"],
 ["ugcImages","用户发布的图片会被其他用户看到","由你决定"],
];
const FACT_QUESTIONS=[...BASIC_FACTS,...CORE_FACTS,...CONTENT_FACTS];
const FACT_LABEL=Object.fromEntries([...FACT_QUESTIONS,["transactionObject","首版交易对象"],["monetizationModel","首版收费模式"],["paymentChannel","首版支付渠道"]].map(([field,label])=>[field,label])) as Partial<Record<keyof ProductContext,string>>;

const EVIDENCE_SOURCE:Record<string,string>={agent_submitted:"开发 Agent 提交（未经验证）",human:"你确认"};

// ---- Local Launch Truth API -------------------------------------------------

type CaseListItem={caseId:string;name:string;active:boolean};
type TruthView={flow:Flow|null;caseId:string|null;caseOrigin:string|null;cases:CaseListItem[]};
type TruthState=TruthView&{writable:boolean};
type WriteResult=({ok:true}&TruthView)|{ok:false;kind:string;error:string;hint?:string};
type TruthApiBody={ok?:boolean;flow?:Flow|null;store?:{contextId:string;caseOrigin:string|null}|null;cases?:CaseListItem[];kind?:string;error?:string;hint?:string};

const WRITE_UNAVAILABLE="保存失败：本地服务没有运行。请在项目目录运行 npm run dev 后刷新页面。";
function writeFailureMessage(result:{kind:string;error:string}){
 if(result.kind==="product_mismatch")return "这份数据属于另一个产品，不能覆盖当前产品。请用顶部的「添加产品」为它单独建立上线进度。";
 if(result.kind==="case_exists")return "已经有一个同名产品。可以在顶部的产品列表中切换到它，或换一个名称。";
 if(result.kind==="unavailable")return WRITE_UNAVAILABLE;
 return `保存失败：${result.error}`;
}
function viewOf(body:TruthApiBody):TruthView|null{
 if(!body.ok)return null;
 return {flow:body.flow??null,caseId:body.store?.contextId??null,caseOrigin:body.store?.caseOrigin??null,cases:body.cases??[]};
}
const viewFields=(view:TruthView):TruthView=>({flow:view.flow,caseId:view.caseId,caseOrigin:view.caseOrigin,cases:view.cases});

export default function Home(){
 const [truth,setTruth]=useState<TruthState|null>(null);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [editor,setEditor]=useState<"create"|"edit"|null>(null);
 const [deleteOpen,setDeleteOpen]=useState(false);
 const [draft,setDraft]=useState<ProductContext>(()=>blankProductContext("new-product",""));
 const fileInput=useRef<HTMLInputElement>(null);

 // Dashboard 与 launch-state CLI 共享同一份 Launch Truth（public/flows/），经本地 dev API 读写。
 // 节点状态两个通道：action "status" = 你的人工确认（含已完成）；action "propose" = 开发 Agent 的提议
 // （WebMCP 工具使用；与 CLI submit 同一契约，永不 completed）。
 const postTruth=useCallback(async(payload:unknown):Promise<WriteResult>=>{
  let body:TruthApiBody;let status=0;
  try{const res=await fetch("/api/launch-state",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});status=res.status;body=await res.json() as TruthApiBody}
  catch{return {ok:false,kind:"unavailable",error:WRITE_UNAVAILABLE}}
  const view=status===200?viewOf(body):null;
  if(view)return {ok:true,...view};
  return {ok:false,kind:body.kind??"unavailable",error:body.error??WRITE_UNAVAILABLE,hint:body.hint};
 },[]);
 const loadTruth=useCallback(async()=>{
  // 本地服务：返回当前产品（没有产品时返回空状态）。
  try{const res=await fetch("/api/launch-state",{cache:"no-store"});if(res.ok){const view=viewOf(await res.json() as TruthApiBody);if(view){setTruth({...view,writable:true});return}}}catch{}
  // 没有本地服务（例如生产构建）：只读读取进度文件快照。
  try{const res=await fetch("/flows/launch-state.json",{cache:"no-store"});if(res.ok){const store=sanitizeStore(await res.json());setTruth({flow:buildFlowFromStore(store),caseId:store.contextId,caseOrigin:store.caseOrigin??null,cases:[{caseId:store.contextId,name:store.productContext.name,active:true}],writable:false});return}}catch{}
  setTruth({flow:null,caseId:null,caseOrigin:null,cases:[],writable:false});
 },[]);
 // truth 只在客户端可取；延迟加载以避免 SSR hydration 不匹配。
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{loadTruth()},[loadTruth]);
 // 开发 Agent 在页面打开期间更新进度（CLI submit / propose-*）后，回到窗口即重新同步。
 useEffect(()=>{const onFocus=()=>{if(document.visibilityState==="visible")loadTruth()};window.addEventListener("focus",onFocus);return()=>window.removeEventListener("focus",onFocus)},[loadTruth]);

 const flow=truth?.flow??null;
 const nodes=useMemo(()=>flow?.stages.flatMap(stage=>stage.nodes)??[],[flow]);
 const selected=nodes.find(n=>n.id===selectedId)??null;
 const completed=nodes.filter(n=>n.status==="completed").length;
 const progress=nodes.length?Math.round(completed/nodes.length*100):0;
 const blocker=nodes.find(n=>n.status==="blocked");
 const undetermined=useMemo(()=>flow?.undeterminedCapabilities??[],[flow]);
 // Next 与「可以同时做」共用 lib/flow-engine/parallel.ts 的依赖判断（与 CLI next / parallel 同一来源）。
 const next=useMemo(()=>flow?selectNextAction(flow):null,[flow]);
 const parallel=useMemo(()=>flow?computeParallelGuidance(flow):null,[flow]);
 const nextDecision=next?.kind==="product_decision"?next.decision:null;
 const nextNode=next?.kind==="node"||next?.kind==="blocker"?next.node:null;
 const alsoNow=useMemo(()=>(parallel?.startableNow??[]).filter(n=>n.nodeId!==nextNode?.id),[parallel,nextNode]);
 const currentStage=nextDecision?flow?.stages.find(stage=>stage.id==="assessment"):flow?.stages.find(stage=>stage.nodes.some(n=>n.id===nextNode?.id));
 const nextSummary=nextDecision?(nextDecision.decision?.prompt??nextDecision.title):nextNode?nextNode.nextAction:next?.kind==="done"?"清单中的步骤都已完成":"暂无可以开始的步骤";

 const accept=useCallback((result:WriteResult)=>{
  if(result.ok){setTruth(current=>({...viewFields(result),writable:current?.writable??true}));return true}
  alert(writeFailureMessage(result));return false;
 },[]);
 const updateStatus=useCallback(async(nodeId:string,status:Status)=>{accept(await postTruth({action:"status",nodeId,status}))},[postTruth,accept]);
 const proposeStatus=useCallback(async(nodeId:string,status:Exclude<Status,"completed">)=>{
  const result=await postTruth({action:"propose",nodePatches:{[nodeId]:{status}}});
  if(result.ok)setTruth(current=>({...viewFields(result),writable:current?.writable??true}));
  return result;
 },[postTruth]);
 const switchCase=async(caseId:string)=>{if(accept(await postTruth({action:"switch",caseId})))setSelectedId(null)};
 const openCreate=()=>{setDraft(blankProductContext("new-product",""));setEditor("create")};
 const openEdit=()=>{if(flow){setDraft(flow.productContext);setEditor("edit")}};
 const submitEditor=async()=>{
  if(editor==="create"){
   const name=draft.name.trim();
   if(!name){alert("请先填写产品名称。");return}
   if(accept(await postTruth({action:"create",productContext:{...draft,name,productId:productIdFromName(name)}}))){setEditor(null);setSelectedId(null)}
   return;
  }
  if(accept(await postTruth({action:"context",productContext:draft}))){setEditor(null);setSelectedId(null)}
 };
 const resetCase=async()=>{if(!confirm("清空当前产品的所有步骤状态和证据？产品信息会保留。"))return;if(accept(await postTruth({action:"reset"})))setSelectedId(null)};
 const deleteCase=async()=>{if(!truth?.caseId)return;const result=await postTruth({action:"delete",caseId:truth.caseId});if(accept(result)){setDeleteOpen(false);setSelectedId(null)}};
 const exportFlow=()=>{if(!flow)return;const blob=new Blob([JSON.stringify(flow,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${flow.flowId}.json`;a.click();URL.revokeObjectURL(url)};
 const importFlow=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=async()=>{let context:ProductContext|undefined;try{context=(JSON.parse(String(reader.result)) as {productContext?:ProductContext}).productContext}catch{}if(context?.schemaVersion!=="1.1"){alert("导入失败：需要一个由 LSE 导出的文件（包含 1.1 版产品信息）。");return}if(accept(await postTruth({action:"context",productContext:context})))setSelectedId(null)};reader.readAsText(file)};

 useEffect(()=>{const context=(document as Document&{modelContext?:{registerTool:(tool:unknown,options?:{signal?:AbortSignal})=>void|Promise<void>}}).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();const register=(tool:unknown)=>Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>undefined);register({name:"read_launch_flow",title:"Read launch flow",description:"Return the active Launch Case, progress, blocker, dependency-eligible next action and startable work.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({caseId:truth?.caseId??null,caseOrigin:truth?.caseOrigin??null,project:flow?.project??null,progress,currentStage:currentStage?.title,blocker:blocker?.blocker,next:next?{kind:next.kind,nodeId:nextNode?.id??nextDecision?.nodeId,action:nextSummary}:null,startableNow:parallel?.startableNow.map(n=>n.nodeId)??[],undetermined:undetermined.length})});register({name:"update_launch_node_status",title:"Propose node status",description:"Agent proposal channel: propose a node status (waiting/blocked/not_started). Never completed; completion is a human confirmation in the dashboard. Same contract as `launch-state submit`.",inputSchema:{type:"object",properties:{nodeId:{type:"string"},status:{type:"string",enum:["waiting","blocked","not_started"]}},required:["nodeId","status"],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:{nodeId:string;status:Exclude<Status,"completed">})=>{const result=await proposeStatus(input.nodeId,input.status);if(!result.ok)throw new Error(result.error);return{nodeId:input.nodeId,status:input.status,channel:"agent_proposal",verification:"proposed_status_only; completion requires human confirmation"}}});return()=>lifecycle.abort()},[truth,flow,progress,currentStage,blocker,next,nextNode,nextDecision,nextSummary,parallel,undetermined.length,proposeStatus]);

 if(!truth)return <main className="loading">正在加载…</main>;
 const coverage=flow?.ruleEvaluation?.coverage;
 return <main className="app-shell">
  <header className="topbar"><div className="brand"><span className="brand-mark"><Sparkles size={17}/></span><span>Launch State Engine</span></div><div className="toolbar">
   {truth.cases.length>0&&<Select value={truth.caseId??""} onValueChange={v=>{if(v&&v!==truth.caseId)switchCase(v)}} disabled={!truth.writable}><SelectTrigger className="product-switcher" aria-label="切换产品"><SelectValue placeholder="选择产品"/></SelectTrigger><SelectContent>{truth.cases.map(c=><SelectItem key={c.caseId} value={c.caseId}>{c.name}</SelectItem>)}</SelectContent></Select>}
   {truth.writable&&truth.cases.length>0&&<button onClick={openCreate}><Plus size={15}/>添加产品</button>}
   {flow&&<><button className="generate-button" onClick={openEdit} disabled={!truth.writable}><WandSparkles size={15}/>编辑产品信息</button><input ref={fileInput} type="file" accept="application/json" hidden onChange={e=>importFlow(e.target.files?.[0])}/><button onClick={()=>fileInput.current?.click()} disabled={!truth.writable}><Upload size={15}/>导入</button><button onClick={exportFlow}><Download size={15}/>导出</button><button className="icon-button" onClick={resetCase} disabled={!truth.writable} aria-label="清空当前产品的步骤状态" title="清空当前产品的步骤状态"><RotateCcw size={15}/></button><button className="icon-button delete-button" onClick={()=>setDeleteOpen(true)} disabled={!truth.writable} aria-label="删除当前产品" title="删除当前产品"><Trash2 size={15}/></button></>}
  </div></header>
  {!truth.writable&&<p className="case-banner">只读视图：要添加产品或更新进度，请在项目目录运行 <code>npm run dev</code> 后打开它显示的地址。</p>}
  {!flow?<EmptyState writable={truth.writable} onCreate={openCreate}/>:<>
   {truth.caseOrigin==="fixture"&&<p className="case-banner">这个产品是用虚构的示例数据创建的，不是你的真实产品。用顶部的「添加产品」录入你自己的产品。</p>}
   <section className="overview"><div className="project-heading"><div className="eyebrow">微信小程序上线</div><h1>{flow.productContext.name}</h1><p>目标：正式发布，普通用户可以搜索进入，并且核心功能可用。</p></div><div className="progress-card"><div><span>整体进度</span><strong>{progress}%</strong></div><Progress value={progress}/><small>{completed} / {nodes.length} 个步骤已完成 · 只统计本清单中的步骤</small></div><div className="state-card"><span>你现在在</span><strong>{currentStage?`${currentStage.index}. ${currentStage.title}`:next?.kind==="done"?"清单已完成":"等待中"}</strong><small>{nextDecision?"还有需要你回答的产品问题；回答后清单会重新计算":currentStage?.purpose??(next?.kind==="done"?"清单中的步骤都已由你确认完成":"剩下的步骤都在等待被阻塞的步骤")}</small></div></section>
   <section className="focus-grid">
    <article className="focus-card action-card"><div className="focus-label"><Sparkles size={16}/>下一步</div>
     {nextDecision?<><h2>先回答一个关于产品的问题</h2><p className="action-line">{nextDecision.decision?.prompt??nextDecision.title}</p><div className="action-meta"><span>需要你决定</span></div><button onClick={openEdit} disabled={!truth.writable}>回答问题<ChevronRight size={15}/></button></>
     :next?.kind==="blocker"&&nextNode?<><h2>先解除阻塞：{nextNode.title}</h2><p className="action-line">{nextNode.blocker?.resolution??"打开这一步，查看阻塞原因并更新状态。"}</p><button onClick={()=>setSelectedId(nextNode.id)}>查看<ChevronRight size={15}/></button></>
     :nextNode?<><h2>{nextNode.title}</h2><p className="action-line">{nextNode.nextAction}</p>{nextNode.where&&<p className="action-where">在哪里：{nextNode.where}</p>}<div className="action-meta"><span>{WHO[nextNode.actorType].label}</span></div><button onClick={()=>setSelectedId(nextNode.id)}>开始处理<ChevronRight size={15}/></button></>
     :next?.kind==="done"?<><h2>清单中的步骤都已完成</h2><p className="action-line">这只代表本清单中的步骤都已由你确认完成，不代表已满足微信的全部要求。</p></>
     :<><h2>暂时没有可以开始的步骤</h2><p className="action-line">剩下的步骤都在等待被阻塞的步骤。先解除阻塞。</p></>}
     {next?.kind!=="done"&&alsoNow.length>0&&<div className="also-now"><span>现在还可以同时做</span><div>{alsoNow.slice(0,4).map(n=><button key={n.nodeId} onClick={()=>setSelectedId(n.nodeId)}>{n.title}</button>)}{alsoNow.length>4&&<small>另有 {alsoNow.length-4} 项</small>}</div><small>依据 LSE 记录的步骤依赖；不代表微信官方确认这些事可以同时进行。</small></div>}
    </article>
    <article className={`focus-card blocker-card ${blocker?"":"clear"}`}><div className="focus-label"><AlertTriangle size={16}/>当前阻塞</div><h2>{blocker?(blocker.blocker?.summary??`「${blocker.title}」已标记为阻塞`):"暂无阻塞"}</h2>{blocker&&<><p>{blocker.blocker?.diagnosis??"打开这一步，查看并更新状态。"}</p><button onClick={()=>setSelectedId(blocker.id)}>查看<ChevronRight size={15}/></button></>}</article>
   </section>
   <section className="flow-section"><div className="section-head"><div><div className="eyebrow">你的上线清单</div><h2>上线步骤</h2></div><div className="legend">{(Object.keys(statusMeta) as Status[]).map(key=><span key={key}><i className={statusMeta[key].className}/>{statusMeta[key].label} {nodes.filter(n=>n.status===key).length}</span>)}</div></div>
    {coverage&&<div className="coverage-note"><p><b>规则覆盖：{coverage.level==="partial"?"部分覆盖":coverage.level==="verified"?"已验证":"未验证"}</b>　{coverage.summary}{progress===100?" 进度 100% 不代表已满足微信的全部要求。":""}</p><details><summary>查看覆盖范围详情</summary><p>{coverage.verifiedFor.join("；")}</p><p>{coverage.boundary}</p><p>规则版本：{flow.ruleEvaluation.registryVersion}</p></details></div>}
    {undetermined.length>0&&<div className="decision-panel"><div className="decision-head"><span>需要你回答的问题</span><strong>{undetermined.length} 个步骤要等你回答后才能确定是否需要</strong></div><div className="decision-list">{undetermined.map(item=><button key={item.nodeId} onClick={openEdit} disabled={!truth.writable}><span>需要你决定</span><strong>{item.decision?.prompt??item.title}</strong><small>会决定是否需要「{item.title}」</small></button>)}</div></div>}
    <div className="stage-list">{flow.stages.map(stage=>{const done=stage.nodes.filter(n=>n.status==="completed").length;return <article className="stage" key={stage.id}><div className="stage-index"><span>{String(stage.index).padStart(2,"0")}</span><div className="stage-line"/></div><div className="stage-body"><div className="stage-title"><div><h3>{stage.title}</h3><p>{stage.purpose}</p></div><span>{done}/{stage.nodes.length}</span></div><div className="node-row">{stage.nodes.map(node=>{const Icon=statusMeta[node.status].icon;return <button className={`node-card ${node.status}`} key={node.id} onClick={()=>setSelectedId(node.id)}><span className={`node-icon ${statusMeta[node.status].className}`}><Icon size={15}/></span><span className="node-copy"><strong>{node.title}</strong><small>{node.nextAction}</small><em className="who-chip">{WHO[node.actorType].chip}</em></span></button>})}</div></div></article>})}</div>
    {flow.excludedCapabilities?.length>0&&<div className="excluded-panel"><div><span>根据你的回答，不需要的步骤</span><strong>{flow.excludedCapabilities.length} 项</strong></div><div className="excluded-list">{flow.excludedCapabilities.map(item=><details key={item.nodeId}><summary>{item.title}</summary><p>{item.why.join(" ")}</p></details>)}</div></div>}
   </section>
  </>}
  <ProductEditor mode={editor??"edit"} open={editor!==null} onOpenChange={open=>{if(!open)setEditor(null)}} draft={draft} setDraft={setDraft} onSubmit={submitEditor}/>
  {flow&&<DeleteProductDialog open={deleteOpen} onOpenChange={setDeleteOpen} productName={flow.productContext.name} caseId={truth.caseId??""} progressCount={nodes.filter(node=>node.status!=="not_started"||node.evidence.length>0||node.blocker).length} onExport={exportFlow} onDelete={deleteCase}/>}
  <Sheet open={Boolean(selected)} onOpenChange={open=>!open&&setSelectedId(null)}><SheetContent className="detail-sheet" side="right">{selected&&flow&&<NodeDetail node={selected} nodes={nodes} stageTitle={flow.stages.find(s=>s.id===selected.stageId)?.title??selected.stageId} writable={truth.writable} onStatus={updateStatus}/>}</SheetContent></Sheet>
 </main>
}

function DeleteProductDialog({open,onOpenChange,productName,caseId,progressCount,onExport,onDelete}:{open:boolean;onOpenChange:(open:boolean)=>void;productName:string;caseId:string;progressCount:number;onExport:()=>void;onDelete:()=>void}){
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="delete-dialog"><DialogHeader><DialogTitle>删除「{productName}」？</DialogTitle><DialogDescription>这会删除这个产品的 Product Context、步骤状态、阻塞和证据。其他产品不会受到影响。</DialogDescription></DialogHeader><div className="delete-warning"><AlertTriangle size={18}/><div><b>{progressCount>0?`这个产品已有 ${progressCount} 个步骤包含进度或证据。`:"这个产品目前没有已记录的步骤进度。"}</b><p>删除后无法在 LSE 中恢复。需要保留记录时，请先导出 JSON 备份。</p><small>Case ID：{caseId}</small></div></div><div className="delete-actions"><button onClick={onExport}><Download size={15}/>先导出备份</button><button onClick={()=>onOpenChange(false)}>取消</button><button className="confirm-delete" onClick={onDelete}><Trash2 size={15}/>确认删除</button></div></DialogContent></Dialog>
}

function EmptyState({writable,onCreate}:{writable:boolean;onCreate:()=>void}){
 return <section className="empty-hero">
  <div className="eyebrow">微信小程序上线</div>
  <h1>把你的产品上线成微信小程序</h1>
  <p>LSE 会根据你的产品情况，列出上线微信小程序需要完成的步骤，并告诉你：现在在哪一步、下一步具体做什么、怎么才算完成、哪些需要你决定、哪些可以同时做。</p>
  <p>它不会替你写代码、提交审核或操作微信后台。这些仍由你（或你的开发 Agent）完成；LSE 负责记录进度、说明原因，并指出下一步。</p>
  {writable?<button className="compile-button" onClick={onCreate}><Plus size={16}/>添加我的产品</button>:null}
  <small>使用开发 Agent？Agent 可以通过命令行读取和更新同一份进度，见 README 中的「Agent 接口」。</small>
 </section>
}

function DetailSection({title,children}:{title:string;children:React.ReactNode}){return <section><h3>{title}</h3>{children}</section>}

function NodeDetail({node,nodes,stageTitle,writable,onStatus}:{node:FlowNode;nodes:FlowNode[];stageTitle:string;writable:boolean;onStatus:(nodeId:string,status:Status)=>void}){
 const who=WHO[node.actorType];
 const nature=NATURE[node.requirementKind??"external_requirement"];
 const app=typeof node.applicability==="string"?null:node.applicability;
 const triggered=(app?.triggeredBy??[]).map(item=>item.split("=")).filter(([,value])=>value==="true").map(([field])=>FACT_LABEL[field as keyof ProductContext]??field);
 const deps=node.dependencies.map(id=>nodes.find(n=>n.id===id)).filter((n):n is FlowNode=>Boolean(n));
 const unmet=deps.filter(dep=>dep.status!=="completed");
 return <>
  <SheetHeader><div className="detail-kicker"><span>{stageTitle}</span><span className={`status-pill ${statusMeta[node.status].className}`}>{statusMeta[node.status].label}</span></div><SheetTitle>{node.title}</SheetTitle><SheetDescription>{who.label}</SheetDescription></SheetHeader>
  <div className="detail-content">
   <DetailSection title="你现在要做什么"><p>{node.requirement}</p>{node.where&&<p className="detail-where"><b>在哪里：</b>{node.where}</p>}</DetailSection>
   <DetailSection title="怎么才算完成"><ul>{node.exitCriteria.map(item=><li key={item}>{item}</li>)}</ul>
    <div className="status-row"><span>当前状态</span><Select value={node.status} disabled={!writable} onValueChange={value=>onStatus(node.id,value as Status)}><SelectTrigger className="status-select"><SelectValue/></SelectTrigger><SelectContent>{(Object.keys(statusMeta) as Status[]).map(key=><SelectItem value={key} key={key}>{statusMeta[key].label}</SelectItem>)}</SelectContent></Select></div>
    <p className="channel-note">满足上面的完成标准后，把状态改为「已完成」。这是你的确认；LSE 不会运行或检查你的小程序。开发 Agent 只能提交进度、阻塞和证据，不能替你标记完成。</p>
   </DetailSection>
   <DetailSection title="为什么需要这一步">{node.why&&<p>{node.why}</p>}<p>{node.whyThisApplies}</p>{triggered.length>0&&<p className="trigger-note">与你的回答有关：{triggered.join("；")}</p>}<p className="nature-line"><span className={nature.className}>{nature.label}</span>{nature.copy}</p></DetailSection>
   <DetailSection title="需要先完成">{deps.length===0?<p>没有需要先完成的步骤。</p>:<><ul>{deps.map(dep=><li key={dep.id}>{dep.title} · {statusMeta[dep.status].label}</li>)}</ul><p className="dependency-note">{unmet.length===0?"前置步骤都已完成，可以开始。":`还有 ${unmet.length} 个前置步骤未完成。`}</p></>}</DetailSection>
   {node.officialSources.length>0&&<DetailSection title="官方依据">{node.officialSources.map(source=><a className="source-link" href={source.url} target="_blank" rel="noreferrer" key={source.url}><span><strong>{source.title}</strong><small>{source.publisher}</small></span><ExternalLink size={15}/></a>)}</DetailSection>}
   {node.fieldNotes.length>0&&<DetailSection title="经验建议 · 非官方要求"><ul>{node.fieldNotes.map(note=><li key={note}>{note}</li>)}</ul></DetailSection>}
   <DetailSection title="证据与阻塞">
    {node.blocker&&<div className="blocker-detail"><strong>{node.blocker.summary}</strong><p>{node.blocker.diagnosis}</p><p><b>怎么解决：</b>{node.blocker.resolution}</p></div>}
    {node.evidence.length?<div className="evidence-list">{node.evidence.map((item,i)=><div key={`${item.label}-${i}`}><ShieldCheck size={16}/><span><strong>{item.label}</strong><small>{item.value}{item.verifiedBy?` · ${EVIDENCE_SOURCE[item.verifiedBy]??item.verifiedBy}`:""}</small></span></div>)}</div>:<p className="empty-note">还没有证据。开发 Agent 提交的证据会显示在这里；提交证据不等于完成。</p>}
   </DetailSection>
   <details className="more-info"><summary>更多信息（供开发 Agent 参考）</summary><dl>
    <dt>步骤 ID</dt><dd>{node.id}</dd>
    <dt>执行者类型</dt><dd>{node.actorType}</dd>
    <dt>事项性质</dt><dd>{node.requirementKind}</dd>
    <dt>复杂度 / 工作量 / 风险</dt><dd>{node.workProfile.complexity} / {node.workProfile.volume} / {node.workProfile.risk}</dd>
    {app&&<><dt>适用规则</dt><dd>{app.matchedRuleIds.join(", ")}</dd></>}
   </dl></details>
  </div>
 </>
}

function ProductEditor({mode,open,onOpenChange,draft,setDraft,onSubmit}:{mode:"create"|"edit";open:boolean;onOpenChange:(open:boolean)=>void;draft:ProductContext;setDraft:(value:ProductContext)=>void;onSubmit:()=>void}){
 const patch=(value:Partial<ProductContext>)=>setDraft({...draft,...value});
 const setMonetization=(value:NonNullable<ProductContext["monetizationModel"]>)=>{
  if(value==="free")patch({monetizationModel:value,transactionObject:"none",paymentChannel:"none",payment:"none",permanentEntitlement:false});
  else patch({monetizationModel:value,transactionObject:draft.transactionObject==="none"?"unknown":draft.transactionObject??"unknown",paymentChannel:draft.paymentChannel==="none"?"unknown":draft.paymentChannel??"unknown",payment:draft.payment==="none"?"unknown":draft.payment,permanentEntitlement:value==="one_time"?true:value==="unknown"?"unknown":false});
 };
 const setTransaction=(value:NonNullable<ProductContext["transactionObject"]>)=>patch({transactionObject:value,payment:value==="none"?"none":value==="physical_goods"||value==="offline_service"?"physical_goods":value==="virtual_goods"?"virtual_goods":"unknown"});
 const paid=draft.monetizationModel!=="free";
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="builder-dialog"><DialogHeader><DialogTitle>{mode==="create"?"添加我的产品":"编辑产品信息"}</DialogTitle><DialogDescription>回答你已经知道的问题，不确定的保持「待确认」。LSE 会据此列出适用于你的上线步骤，之后随时可以修改。</DialogDescription></DialogHeader>
  <section className="editor-section"><div className="editor-heading"><b>基础信息</b><small>先回答这些；其余按功能展开</small></div><div className="builder-grid"><label className="wide">产品名称<Input value={draft.name} placeholder="例如：我的记账工具" onChange={e=>patch({name:e.target.value})}/>{mode==="edit"&&<small className="case-id-note">要为另一个产品做上线，请用顶部的「添加产品」。</small>}</label><label>小程序账号主体<Select value={draft.subjectType} onValueChange={v=>patch({subjectType:v as ProductContext["subjectType"]})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="unknown">待确认</SelectItem><SelectItem value="personal">个人</SelectItem><SelectItem value="individual_business">个体工商户</SelectItem><SelectItem value="enterprise">企业</SelectItem><SelectItem value="organization">其他组织</SelectItem></SelectContent></Select></label><label>产品形态（不是微信服务类目）<Select value={draft.category} onValueChange={v=>patch({category:v as ProductContext["category"]})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="unknown">待确认</SelectItem><SelectItem value="local_tool">本地工具</SelectItem><SelectItem value="productivity">效率工具</SelectItem><SelectItem value="community">社区 / 社交</SelectItem><SelectItem value="content">内容</SelectItem><SelectItem value="commerce">电商 / 交易</SelectItem><SelectItem value="service">生活 / 到店服务</SelectItem><SelectItem value="education">教育</SelectItem><SelectItem value="game">游戏</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select><small className="case-id-note">这里只用于描述产品并提示覆盖边界；正式服务类目需在微信后台另行选择和核验。</small></label></div><div className="capability-grid compact">{BASIC_FACTS.map(([field,label,owner])=><TriStateControl key={field} label={label} owner={owner} value={(draft[field]??"unknown") as FactValue} onChange={value=>patch({[field]:value})}/>)}</div></section>
  <details className="editor-group" open><summary><span><b>功能特征</b><small>登录、云端、提醒与敏感能力</small></span><ChevronRight size={16}/></summary><div className="capability-grid">{CORE_FACTS.map(([field,label,owner])=><TriStateControl key={field} label={label} owner={owner} value={(draft[field]??"unknown") as FactValue} onChange={value=>patch({[field]:value})}/>)}</div></details>
  <details className="editor-group"><summary><span><b>文件、图片与用户内容</b><small>区分私下上传与向其他用户发布</small></span><ChevronRight size={16}/></summary><div className="capability-grid">{CONTENT_FACTS.map(([field,label,owner])=><TriStateControl key={field} label={label} owner={owner} value={(draft[field]??"unknown") as FactValue} onChange={value=>patch({[field]:value})}/>)}</div><p className="group-note">文件/图片表示用户选择或上传；UGC 只表示内容会被其他用户看到。仅供用户自己使用的私有内容不要勾为 UGC。</p></details>
  <details className="editor-group" open={draft.monetizationModel!=="free"&&draft.monetizationModel!==undefined}><summary><span><b>交易与收费</b><small>交易对象、收费模式和支付渠道分开记录</small></span><ChevronRight size={16}/></summary><div className="transaction-grid"><label>收费模式 · 由你决定<Select value={draft.monetizationModel??"unknown"} onValueChange={v=>setMonetization(v as NonNullable<ProductContext["monetizationModel"]>)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="unknown">待确认</SelectItem><SelectItem value="free">不收费</SelectItem><SelectItem value="one_time">一次性收费</SelectItem><SelectItem value="subscription">订阅</SelectItem><SelectItem value="usage_based">按次 / 按量</SelectItem><SelectItem value="commission">交易抽佣</SelectItem><SelectItem value="advertising">广告变现</SelectItem><SelectItem value="mixed">多种模式</SelectItem></SelectContent></Select></label>{paid&&<><label>交易对象 · 由你决定<Select value={draft.transactionObject??"unknown"} onValueChange={v=>setTransaction(v as NonNullable<ProductContext["transactionObject"]>)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="unknown">待确认</SelectItem><SelectItem value="none">没有用户交易</SelectItem><SelectItem value="physical_goods">实物商品</SelectItem><SelectItem value="offline_service">线下 / 到店服务</SelectItem><SelectItem value="virtual_goods">虚拟商品 / 数字内容 / 数字权益</SelectItem><SelectItem value="donation">捐赠 / 打赏</SelectItem></SelectContent></Select></label><label>计划支付渠道 · 由你决定<Select value={draft.paymentChannel??"unknown"} onValueChange={v=>patch({paymentChannel:v as NonNullable<ProductContext["paymentChannel"]>})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="unknown">待确认</SelectItem><SelectItem value="none">不在小程序内收款</SelectItem><SelectItem value="wechat_pay">微信小程序支付</SelectItem><SelectItem value="wechat_virtual_payment">微信虚拟支付</SelectItem><SelectItem value="external_or_offline">线下 / 外部渠道</SelectItem><SelectItem value="multiple">多种渠道</SelectItem></SelectContent></Select></label></>}</div><p className="group-note">LSE 不会把所有收费业务当成虚拟支付。当前 Registry 只对虚拟商品/数字权益的虚拟支付路径做了有限核验；普通支付等专项要求仍属于未覆盖边界。</p></details>
  <div className="builder-note">「待确认」不会被当成「否」：相关步骤会显示为需要你回答的问题，直到你确认。</div><button className="compile-button" onClick={onSubmit}><WandSparkles size={16}/>{mode==="create"?"创建并生成上线步骤":"保存并更新上线步骤"}</button>
 </DialogContent></Dialog>
}
function TriStateControl({label,owner,value,onChange}:{label:string;owner:"事实"|"由你决定";value:FactValue;onChange:(value:FactValue)=>void}){return <label className="tri-state-field"><span><b>{label}</b><small>{owner}</small></span><Select value={String(value)} onValueChange={v=>onChange(v==="true"?true:v==="false"?false:"unknown")}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="unknown">待确认</SelectItem><SelectItem value="true">是</SelectItem><SelectItem value="false">否</SelectItem></SelectContent></Select></label>}
