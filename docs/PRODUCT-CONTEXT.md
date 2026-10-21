# Product Context

Product Context 是 LSE 编译 Applicable Flow 的唯一输入。类型定义以 `lib/flow-engine/types.ts` 为准，校验以 `lib/flow-engine/compiler.ts` 的 `validateProductContext` 为准。模板见 [`examples/product-context.json`](../examples/product-context.json)。

## 写入规则

- `schemaVersion` 必须是 `"1.1"`。
- `productId` 只能包含字母、数字、`.`、`_`、`-`，并以字母或数字开头。Launch Case ID 为 `<productId>:wechat-launch`。
- 三态字段的取值是 JSON 布尔值 `true` / `false` 或字符串 `"unknown"`，不是字符串 `"true"` / `"false"`。
- 不确定就保留 `"unknown"`。LSE 不会把 unknown 当成 false。
- 未列出的字段和 `null` 会被拒绝。
- 属于产品决策的事实由用户决定。Agent 不应替用户填写，应询问用户。

## 字段与可选值

括号内为 Dashboard 表单中的显示文字。

| 字段 | 必填 | 可选值 |
|---|---|---|
| `schemaVersion` | 是 | `"1.1"` |
| `productId` | 是 | 见上文 |
| `name` | 是 | 产品显示名称 |
| `subjectType` | 是 | `personal`（个人）、`individual_business`（个体工商户）、`enterprise`（企业）、`organization`（其他组织）、`unknown` |
| `category` | 是 | `local_tool`（本地工具）、`productivity`（效率工具）、`community`（社区 / 社交）、`content`（内容）、`commerce`（电商 / 交易）、`service`（生活 / 到店服务）、`education`（教育）、`game`（游戏）、`other`（其他）、`unknown` |
| `existingProduct` | 是 | 三态：已经有一个在运行的产品（网页、App 等） |
| `hasWechatAccount` | 是 | 三态：已经有微信小程序账号 |
| `hasUserAccounts` | 是 | 三态：用户需要先登录或被识别，才能使用核心功能 |
| `cloudData` | 是 | 三态：首版需要在服务器上保存或读取数据 |
| `externalProcessing` | 否 | 三态：首版会把用户内容发送到外部服务处理（例如 AI 接口）。缺省按 unknown 处理 |
| `reminder` | 是 | 三态：首版会给用户发提醒（订阅消息） |
| `files` | 是 | 三态：用户可以选择或上传非图片文件 |
| `imageUpload` | 是 | 三态：用户可以选择或上传图片 |
| `clipboard` | 是 | 三态：首版会读写剪切板 |
| `location` | 是 | 三态：首版使用位置信息 |
| `ugcText` | 是 | 三态：用户发布的文字会被其他用户看到 |
| `ugcImages` | 是 | 三态：用户发布的图片会被其他用户看到 |
| `transactionObject` | 否 | `none`（没有用户交易）、`physical_goods`（实物商品）、`offline_service`（线下 / 到店服务）、`virtual_goods`（虚拟商品 / 数字内容 / 数字权益）、`donation`（捐赠 / 打赏）、`unknown` |
| `monetizationModel` | 否 | `free`（不收费）、`one_time`（一次性收费）、`subscription`（订阅）、`usage_based`（按次 / 按量）、`commission`（交易抽佣）、`advertising`（广告变现）、`mixed`（多种模式）、`unknown` |
| `paymentChannel` | 否 | `none`（不在小程序内收款）、`wechat_pay`（微信小程序支付）、`wechat_virtual_payment`（微信虚拟支付）、`external_or_offline`（线下 / 外部渠道）、`multiple`（多种渠道）、`unknown` |
| `payment` | 是 | 兼容字段：`none`、`physical_goods`、`virtual_goods`、`unknown` |
| `permanentEntitlement` | 是 | 三态，兼容字段 |

`payment` 与 `permanentEntitlement` 是早期版本的支付字段。缺少 `transactionObject` / `monetizationModel` / `paymentChannel` 时，LSE 在读取时用它们推导出等价值；新字段一旦填写，以新字段为准。

## 哪些 unknown 会生成待确认问题

只有 Rule Registry 条件中使用的字段，才会因为 `unknown` 生成「待你决定」的问题（`launch-state undetermined`）：

| 字段为 unknown | 待确认的节点 |
|---|---|
| `hasUserAccounts` | 用户身份与会话、隐私指引 |
| `cloudData` | 生产后端 |
| `externalProcessing` | 隐私指引 |
| `reminder` | 订阅消息 |
| `files`、`imageUpload` | 文件 / 图片隐私、隐私指引 |
| `clipboard` | 剪切板隐私、隐私指引 |
| `location` | 位置隐私、隐私指引 |
| `ugcText`、`ugcImages` | UGC 治理、内容安全 |
| `transactionObject` | 微信虚拟支付 |

以下字段为 unknown 时不会生成问题：`subjectType`、`category`、`existingProduct`、`hasWechatAccount`、`monetizationModel`、`paymentChannel`，以及兼容字段 `payment`、`permanentEntitlement`。它们用于说明、兼容推导或作为支付问题的补充字段，但不单独决定任何节点。这不代表这些事实不重要：例如服务类目和主体类型仍需在微信后台按实际业务核验。

同一条规则中只要有一个条件已经确定适用，其他仍为 unknown 的字段就不会再单独提问。例如 `files: true` 时，`imageUpload: "unknown"` 不会再生成文件 / 图片相关问题。
