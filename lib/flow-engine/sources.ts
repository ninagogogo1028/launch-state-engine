import type { Source } from "./types.ts";

// First-hand WeChat documentation is preferred for every node. Each URL below
// was checked to resolve to the named page on its lastVerifiedAt date.
export const SOURCES: Source[] = [
  { id:"wx-introduction", title:"小程序接入指南（注册、AppID、服务类目、提交审核与发布）", url:"https://developers.weixin.qq.com/miniprogram/introduction/", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-service-category", title:"小程序开放的服务类目", url:"https://developers.weixin.qq.com/miniprogram/product/material/", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-review-reject", title:"小程序常见拒绝情形", url:"https://developers.weixin.qq.com/miniprogram/product/reject.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-operation-rules", title:"小程序平台运营规范", url:"https://developers.weixin.qq.com/miniprogram/product/", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-record", title:"小程序备案操作指引", url:"https://developers.weixin.qq.com/miniprogram/product/record/record_guidelines.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-framework", title:"小程序开发指南", url:"https://developers.weixin.qq.com/miniprogram/dev/framework/", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-login", title:"小程序登录", url:"https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-network", title:"网络（服务器域名配置）", url:"https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-privacy-guide", title:"用户隐私保护指引填写说明", url:"https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-privacy", title:"小程序用户隐私保护指引内容介绍", url:"https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/miniprogram-intro.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-privacy-dev", title:"小程序隐私协议开发指南", url:"https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-subscribe", title:"小程序订阅消息", url:"https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-subscribe-dev", title:"小程序订阅消息（用户通过弹窗订阅）开发指南", url:"https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-request-subscribe", title:"wx.requestSubscribeMessage", url:"https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-virtual-payment", title:"wx.requestVirtualPayment（虚拟支付）", url:"https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-18" },
  { id:"wx-mini-program-payment", title:"小程序支付接入指引", url:"https://pay.wechatpay.cn/static/applyment_guide/applyment_detail_miniapp.shtml", publisher:"微信支付商户平台", authority:"official", lastVerifiedAt:"2026-10-18" },
  { id:"wx-request-payment", title:"小程序调起支付（wx.requestPayment）", url:"https://pay.wechatpay.cn/doc/v3/merchant/4012791898", publisher:"微信支付商户文档中心", authority:"official", lastVerifiedAt:"2026-10-18" },
  { id:"wx-sec-center", title:"小程序安全接口列表（内容安全检测）", url:"https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  { id:"wx-release", title:"小程序协同工作和发布（预览、上传、体验版、提交审核、发布）", url:"https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html", publisher:"微信开放文档", authority:"official", lastVerifiedAt:"2026-10-13" },
  // Field experience is never an official requirement and has no public URL.
  { id:"field-launch-practice", title:"上线实践经验（维护者整理，非官方）", url:"", publisher:"Launch State Engine", authority:"field_experience", lastVerifiedAt:"2026-10-04" }
];

export const sourceById = Object.fromEntries(SOURCES.map(source => [source.id, source]));
