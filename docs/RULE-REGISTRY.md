# Rule Registry

## V0.1 transaction boundary

Product Context records three separate facts: `transactionObject`, `monetizationModel`, and `paymentChannel`. They must not be collapsed into a generic “paid” flag.

- Ordinary Mini Program payment uses the WeChat Pay merchant flow and `wx.requestPayment`; merchant onboarding and the Mini Program AppID binding are separate from Virtual Payment.
- Virtual goods, digital content, and digital entitlements are the only transaction object currently connected to LSE's existing `cap-virtual-payment` node.
- Recognizing physical goods, offline services, advertising, commission, donation, or an ordinary payment channel does not mean the Registry covers all requirements for those businesses. Those families remain explicitly outside current verified coverage.
- Existing Product Context 1.1 documents containing only legacy `payment` remain readable through a non-writing compatibility projection. Launch Case progress is not migrated or overwritten.

Official references verified 2026-10-18: WeChat Pay's [Mini Program payment onboarding guide](https://pay.wechatpay.cn/static/applyment_guide/applyment_detail_miniapp.shtml), [wx.requestPayment merchant documentation](https://pay.wechatpay.cn/doc/v3/merchant/4012791898), and WeChat Open Docs' [wx.requestVirtualPayment](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html).

## Product Context

`ProductContext` 是事实输入，不包含判断：主体类型、产品类别、是否已有微信账号、用户账号、云端数据、外部处理、支付类型、永久权益、Reminder、文件、图片、剪切板、UGC 文本、UGC 图片和位置。布尔事实是三态（`true` / `false` / `"unknown"`）；缺失的可选字段按 unknown 处理。模板见 `examples/product-context.json`。

## Rule

```ts
type Rule = {
  id: string
  title: string
  authority: "official" | "field_experience"
  requirementKind: RequirementKind
  when: Condition
  includeNodeIds?: string[]
  excludeNodeIds?: string[]
  addFieldNotes?: { nodeId: string; note: string; caseId?: string }[]
  sourceIds: string[]
  lastVerifiedAt: string
  explanation: string
}
```

Condition 只支持 `eq`、`neq`、`truthy`、`all` 和 `any`。这是刻意限制：当前目标是证明动态 Flow，不是建设通用规则语言。

## 边界

- `official`：来自微信、腾讯云等一手资料，可以驱动节点适用性。
- `field_experience`：案例或开发经验，只能追加 field note，不替代官方依据。
- 动态准入条件无法从公开资料稳定确认时，节点要求写成“在官方后台核对当前准入”，不把推测写成 hard requirement。
- `field_experience` 规则来自维护者整理的上线实践经验（来源 `field-launch-practice`，无公开链接）。目前只有 `field.subscribe-message-end-to-end` 一条，为 `cap-reminder` 追加一条经验建议，不创建或升级任何要求。
- 官方来源优先使用微信开放文档的一手页面（见 `lib/flow-engine/sources.ts`，每条记录核对日期）。

## Fixture 结果

Fixture 是用于验证编译行为的示例产品事实，不是任何产品的上线状态。

| Fixture | Included | 主要条件节点 | Excluded |
|---|---:|---|---:|
| 示例：极简本地工具 | 10 | 无 | 10 |
| 示例：效率工具（含登录、提醒与付费） | 17 | 账号、云端、隐私、Reminder、文件、剪切板、虚拟支付 | 3 |
| 示例：UGC 社区 | 16 | 账号、云端、隐私、图片、UGC 治理、内容安全 | 4 |

执行 `npm run fixtures` 可输出每个 fixture 的完整节点和命中规则。
