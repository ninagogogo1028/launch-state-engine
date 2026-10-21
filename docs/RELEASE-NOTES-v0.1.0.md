# Launch State Engine v0.1.0

First public release of Launch State Engine (LSE): a local-first launch checklist and shared launch state for taking an existing product to a WeChat Mini Program release. Humans use the Dashboard; coding agents use the CLI. Both read and write the same local data, and only the human can mark a step completed.

## Highlights

- Describe a product with tri-state facts: yes, no, or unknown. Unknown is never treated as no.
- Generate only the launch steps that apply, from a separate Rule Registry, with the reason each conditional step is included, excluded or still waiting for your answer.
- For every step: what to do, where, exit criteria, dependencies, official WeChat sources, and field experience kept separate from official requirements.
- Next action, current blocker and work that can start in parallel, derived from recorded dependencies.
- A model-agnostic CLI for coding agents. It can run from any directory, including your product repository, and always uses the LSE repository's data (or one chosen with `--root` / `LSE_ROOT`).
- Agents can propose progress, blockers and evidence. Agent evidence is labelled as unverified, and agents can never mark a step completed.
- Create, switch, edit and delete isolated local products.
- The rule coverage boundary is shown in the Dashboard and in the flow data.

## Important limitations

- LSE does not write or migrate Mini Program code, deploy services, operate the WeChat admin console or submit a review.
- LSE is not an official WeChat tool and not a compliance audit. Rule coverage is partial: specialist requirements for ordinary Mini Program payment, physical orders and fulfilment, advertising, commission, donations, and for game, commerce, education and content products are not fully covered.
- A 100% checklist does not prove that every official requirement has been satisfied or that a Mini Program will pass review.
- Data is stored under `public/flows/` in the LSE repository. It is ignored by Git and excluded from builds.
- Backups: to keep a product with its progress, copy its file under `public/flows/launch-cases/`. Dashboard export is a readable record; Dashboard import restores product facts only, not step statuses, blockers or evidence.
- Single-user and local only: no accounts, cloud sync, collaboration, live push between CLI and Dashboard, Agent orchestration or authenticated local API.
- Verified on macOS with Node.js 25. Windows, Linux and Node.js 22 have not been tested yet.

## Getting started

Requires Node.js 22.13 or later.

```bash
git clone https://github.com/ninagogogo1028/launch-state-engine.git
cd launch-state-engine
npm ci
npm run dev
```

Open the local URL printed in the terminal and click 「添加我的产品」.

See the [README](https://github.com/ninagogogo1028/launch-state-engine/blob/v0.1.0/README.md) for Dashboard use and agent setup (in Chinese), and the [Coverage Matrix](https://github.com/ninagogogo1028/launch-state-engine/blob/v0.1.0/docs/COVERAGE-MATRIX.md) for verified, partial and unverified areas.
