import type { ProductContext } from "./types.ts";

// Fictional example products used by tests, `npm run fixtures` and
// `launch-state case-create --from-fixture <name>`. They are not real products
// and no Launch Case is created from them unless explicitly requested.
export const FIXTURES: Record<string, ProductContext> = {
  minimal:{schemaVersion:"1.1",productId:"example-local-tool",name:"示例：极简本地工具",subjectType:"personal",category:"local_tool",existingProduct:true,hasWechatAccount:false,hasUserAccounts:false,cloudData:false,externalProcessing:false,payment:"none",permanentEntitlement:false,reminder:false,files:false,imageUpload:false,clipboard:false,ugcText:false,ugcImages:false,location:false},
  productivity:{schemaVersion:"1.1",productId:"example-productivity-app",name:"示例：效率工具（含登录、提醒与付费）",subjectType:"personal",category:"productivity",existingProduct:true,hasWechatAccount:true,hasUserAccounts:true,cloudData:true,externalProcessing:true,payment:"virtual_goods",permanentEntitlement:true,reminder:true,files:true,imageUpload:false,clipboard:true,ugcText:false,ugcImages:false,location:false},
  ugc:{schemaVersion:"1.1",productId:"example-ugc-community",name:"示例：UGC 社区",subjectType:"enterprise",category:"community",existingProduct:true,hasWechatAccount:true,hasUserAccounts:true,cloudData:true,externalProcessing:true,payment:"none",permanentEntitlement:false,reminder:false,files:false,imageUpload:true,clipboard:false,ugcText:true,ugcImages:true,location:false}
};
