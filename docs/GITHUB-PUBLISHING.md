# GitHub publishing metadata

Planned repository: `ninagogogo1028/launch-state-engine` (not created yet).

## Repository

- **Name:** `launch-state-engine`
- **Description:** `Local launch checklist and shared state for taking an existing product to a WeChat Mini Program release. Dashboard for humans, CLI for coding agents; completion is always human-confirmed.`
- **Topics:** `wechat-mini-program`, `launch-checklist`, `release-management`, `developer-tools`, `local-first`, `coding-agents`, `ai-agents`, `cli`, `typescript`, `nextjs`
- **License:** MIT

## First release

- **Tag:** `v0.1.0`
- **Title:** `Launch State Engine v0.1.0`
- **Body:** paste [`RELEASE-NOTES-v0.1.0.md`](RELEASE-NOTES-v0.1.0.md). Its links are absolute URLs pinned to the `v0.1.0` tag, so they work on the Release page once the repository and tag exist.

## Publishing checklist

1. Create an empty public repository `ninagogogo1028/launch-state-engine` without a generated README, license or `.gitignore`.
2. Add it as `origin` for this local repository.
3. Review `git status`, `git log --oneline` and `git ls-files` one final time.
4. Push `main`.
5. Create tag `v0.1.0` on the verified release commit and push the tag.
6. Create the GitHub Release with the title and body above.
7. Set the description and topics, and confirm GitHub detects the MIT license.
8. Check that the README screenshots render and that the clone URL and Release links open.

Do not upload `public/flows/`, `dist/`, local build caches or internal audit material.
