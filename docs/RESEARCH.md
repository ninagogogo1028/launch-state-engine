# Ecosystem research & reuse decisions

研究日期：2026-10-04。优先采用官方文档和原始 repository。

| 现有能力 | 已解决的问题 | LSE 的处理 |
|---|---|---|
| WorkBuddy | 通用电脑操作与任务执行；适合自然语言驱动操作 | 仅作为可替换执行能力，不进入状态机字段 |
| Tencent CodeBuddy | 小程序 IDE、代码生成/修改、补全、测试与评审 | 不重做 IDE 或 Coding Agent |
| `TencentCloudBase/mp-skills` | 创建、改造、校验微信 AI Mode Skill | 不重做 Skill generator/validator；可作为条件节点 guidance |
| `wechat-miniprogram/ai-mode-skills` | 从源码生成、验证、评测 AI Mode Skills；含 runtime probe | 不重做 generate/validate/eval pipeline |
| `TencentCloudBase/cloudbase-skills` | CloudBase auth、数据库、云函数、CloudRun、存储和部署指导 | 不重做云基础设施；节点只记录部署状态与 evidence |
| `mzopedia/develop-wechat-ai-miniprograms` | 开发→分层验证→上传→审核→发布 SOP 与独立 preflight | 复用其分层验证与 preflight 思路；LSE 提供跨工具的状态与证据面 |
| 微信开发者工具 / 公众平台 | 编译、预览、上传、体验版、审核、发布与后台声明 | 作为 authoritative execution surface；HUMAN 节点必须回到平台完成 |

## License 结论

- `TencentCloudBase/mp-skills`：MIT，可合法复用；LSE 仅引用，不复制实现。
- `TencentCloudBase/cloudbase-skills`：MIT，可合法复用；LSE 仅引用。
- `mzopedia/develop-wechat-ai-miniprograms`：MIT，可复用其独立 preflight；LSE 未复制代码。
- `wechat-miniprogram/ai-mode-skills`：使用前应再次核对仓库当前 LICENSE；LSE 仅链接官方仓库，不把代码作为 dependency。

## 关键产品结论

现有工具已经擅长“做”：写代码、部署后端、生成 Skill、预检、在开发者工具中验证。缺口是“针对这个产品，哪些步骤适用、现在在哪、为何卡住、什么 evidence 才算完成”。因此 LSE 应拥有 execution 之前的 state/evidence contract，而不是执行器。

## 一手来源

- [TencentCloudBase/mp-skills](https://github.com/TencentCloudBase/mp-skills)
- [wechat-miniprogram/ai-mode-skills](https://github.com/wechat-miniprogram/ai-mode-skills)
- [TencentCloudBase/cloudbase-skills](https://github.com/TencentCloudBase/cloudbase-skills)
- [mzopedia/develop-wechat-ai-miniprograms](https://github.com/mzopedia/develop-wechat-ai-miniprograms)
- [微信小程序框架](https://developers.weixin.qq.com/miniprogram/dev/framework/)
- [微信小程序订阅消息](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html)
- [腾讯云：小程序隐私保护指引适配](https://cloud.tencent.cn/document/product/1301/97930)
- [腾讯云：APP/小程序备案常见问题](https://cloud.tencent.com/document/faq/243/97691)
