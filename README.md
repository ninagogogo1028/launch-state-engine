# Launch State Engine

Launch State Engine（LSE）是一个本地运行、model-agnostic 的微信小程序上线 Dashboard + State Engine。

你描述产品事实，LSE 根据 Rule Registry 生成这个产品当前适用的上线清单，并持续显示进度、下一步、阻塞、依赖、完成标准、官方依据和证据。人类使用 Dashboard；任意开发 Agent 可以通过 CLI 读写同一份本地 Launch Truth。

> LSE 不是自动发布工具，也不是完整的微信官方规则数据库。它不写代码、不部署、不操作微信公众平台，也不保证小程序通过审核。清单进度 100% 不代表所有微信官方要求都已满足。

## 适合谁

- 第一次把已有 Web、App 或本地工具迁移为微信小程序的开发者；
- 希望把分散的上线要求、状态、阻塞和证据放在一个地方的小团队；
- 使用 Coding Agent 开发，但希望把产品决策和最终完成确认保留给人的用户。

## V0.1 能做什么

- 用三态 Product Context（是 / 否 / 待确认）描述产品事实；
- 生成可解释的 Applicable Flow，并区分适用、不适用和待确认路径；
- 展示 Next Action、当前主阻塞、可并行工作和完整 Launch Checklist；
- 查看节点依赖、完成标准、官方来源、经验建议和 evidence；
- 记录人工状态及 Agent 提交的进度、阻塞和 evidence；
- 创建、切换、编辑、导入、导出和删除多个本地产品；
- 明确显示当前 Rule Registry 的覆盖边界。

所有状态默认保存在本机，不需要账号、云同步或模型 API。

## 安装与启动

要求：Node.js 22.13 或更高版本。

```bash
git clone <your-repository-url>
cd launch-state-engine
npm ci
npm run dev
```

启动后，在浏览器中打开终端输出的本地地址（`Local:` 一行）。

首次启动没有预置产品。点击「添加我的产品」，填写已知信息；不确定的问题保留「待确认」，LSE 不会把 unknown 当成 false。提交后即可获得第一份上线清单，不需要 CLI 或手写 JSON。

## Dashboard 使用

- **切换产品**：用顶部产品选择器切换，各产品状态相互隔离。
- **编辑产品信息**：修改 Product Context 后重新计算 Applicable Flow，已有节点进度按稳定节点 ID 保留。
- **记录进度**：点开节点查看要求和完成标准，由人选择未开始、进行中、阻塞或已完成。
- **导出**：下载当前 Flow JSON，适合备份或审查。
- **导入**：导入 LSE 导出的 JSON 中的 Product Context；导入不会创建跨产品的状态覆盖。
- **删除**：删除前会列明影响范围并二次确认。有真实进度时建议先导出备份。删除当前产品后会切换到其他产品，没有其他产品时回到空状态。

## 与 AI Agent 协作

Dashboard 和 CLI 使用同一份本地数据：

```bash
npm run launch-state -- status
npm run launch-state -- next
npm run launch-state -- parallel
npm run launch-state -- node <nodeId>
npm run launch-state -- undetermined
npm run launch-state -- propose-blocker <nodeId> <summary> <diagnosis> <resolution>
npm run launch-state -- propose-evidence <nodeId> <type> <label> <value>
```

运行 `npm run launch-state -- help` 查看完整命令。

权限边界：

- 人类可以在 Dashboard 中确认节点 `completed`；
- Agent 只能提议 `not_started`、`waiting` 或 `blocked`，并提交 blocker/evidence；
- Agent evidence 会标记为 `agent_submitted`，不等于已验证完成；
- 遇到产品决策时，Agent 必须把决定权交还给用户；
- LSE 自己的 test/build 结果不会完成用户项目的上线节点。

这是接口契约，不是系统安全边界。本地 JSON 和开发服务器 API 没有认证，请只在可信设备和可信本地网络环境中运行。

## 本地数据与备份

运行时数据位于：

```text
public/flows/launch-state.json
public/flows/launch-cases/<caseId>.json
```

`public/flows/` 已被 Git 忽略，不会进入正常提交；`npm run build` 也会把它从构建产物中排除。它包含 Product Context、状态、阻塞和 evidence，应按用户数据处理。

重要数据请定期使用 Dashboard「导出」备份。删除产品不可在 LSE 内撤销；先导出，再删除。不要把真实 Launch Case 文件复制到公开 issue、日志或 Git 仓库。

## 规则覆盖范围

V0.1 的覆盖等级是 **partial**：主要覆盖通用微信小程序上线流程，以及登录、云端数据、隐私、提醒、文件/图片、剪切板、位置、UGC 和虚拟支付等有限的已核验条件路径。

以下领域尚未形成完整专项规则：普通小程序支付、实物订单与履约、广告、抽佣、捐赠，以及游戏、电商、教育、内容等产品类型的全部专项要求。未生成节点不代表没有要求。

Product Context 中的“产品形态”只是 LSE 内部的解释与覆盖提示，不是微信官方服务类目。正式类目和主体资质必须在微信后台按实际业务核验。

完整边界见 [Coverage Matrix](docs/COVERAGE-MATRIX.md)。规则来源和维护方式见 [Rule Registry](docs/RULE-REGISTRY.md)。

## 开发与验证

```bash
npm test
npm run fixtures
npm run typecheck
npm run lint
npm run build
```

主要目录：

```text
app/                 Dashboard
build/               本地 Launch Truth API 插件与构建入口
components/ui/       UI primitives
docs/                架构、状态模型、规则和研究文档
examples/            Product Context 模板
lib/flow-engine/     Rule Registry、节点目录和 Flow compiler
lib/launch-store*    本地状态读写与隔离
scripts/             CLI 与 fixture runner
tests/               回归测试
```

V0.1 是 local-first、单用户版本，不包含账号系统、云同步、团队协作、微信后台连接、规则自动抓取、Agent orchestration 或自动发布。

## License

[MIT](LICENSE) © 2026 Nina Jia。

仓库包含基于 shadcn/ui 的 UI primitives 和样式；对应 MIT 版权声明保留在 [`vendor/shadcn-tailwind-4.13.0.LICENSE.md`](vendor/shadcn-tailwind-4.13.0.LICENSE.md)。安装依赖各自受其上游许可证约束。
