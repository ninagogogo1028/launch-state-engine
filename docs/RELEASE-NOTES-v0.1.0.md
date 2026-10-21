# Launch State Engine v0.1.0

First public release of Launch State Engine: a local-first Launch Dashboard + State Engine for taking an existing product toward a WeChat Mini Program production launch.

## Highlights

- Describe a product with tri-state facts: yes, no, or unknown.
- Compile a small, explainable Applicable Flow from a separate Rule Registry.
- Track launch stages, dependencies, next action, blockers, evidence and exit criteria.
- Distinguish official requirements, conditional requirements, product decisions and field experience.
- Create, switch, edit, import, export and delete isolated local Launch Cases.
- Share one local Launch Truth between the human Dashboard and a model-agnostic CLI.
- Preserve human authority over completion: Agent claims and evidence never automatically become verified completion.
- Show the Registry coverage boundary directly in the Dashboard and Flow data.

## Important limitations

- LSE does not write or migrate Mini Program code, deploy services, operate the WeChat admin console or submit a review.
- The Rule Registry is intentionally partial. Specialist requirements for many product categories and transaction models are not fully covered.
- A 100% checklist does not prove that every official requirement has been satisfied or that a Mini Program will pass review.
- Local development data is stored under `public/flows/`; back it up with Dashboard export and do not commit it.
- V0.1 is local-first and single-user. It has no accounts, cloud sync, collaboration, Agent orchestration or authenticated local API.

## Requirements

- Node.js 22.13+
- `npm ci`
- `npm run dev`

See the [README](../README.md) for first-use instructions and the [Coverage Matrix](COVERAGE-MATRIX.md) for verified, partial and unverified areas.
