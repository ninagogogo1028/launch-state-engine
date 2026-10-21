# GitHub publishing metadata

## Repository

- **Recommended name:** `launch-state-engine`
- **Description:** `Local-first launch dashboard and state engine for taking existing products toward a WeChat Mini Program release.`
- **Topics:** `wechat-mini-program`, `release-management`, `launch-checklist`, `state-machine`, `developer-tools`, `local-first`, `product-context`, `evidence`, `typescript`, `nextjs`
- **License:** MIT

## First release

- **Tag:** `v0.1.0`
- **Title:** `Launch State Engine v0.1.0`
- **Body:** use [`RELEASE-NOTES-v0.1.0.md`](RELEASE-NOTES-v0.1.0.md).

## Publishing checklist

1. Create an empty public GitHub repository without generated README, license or `.gitignore` files.
2. Add that repository as `origin` for this local repository.
3. Review `git status`, `git log --oneline`, and `git ls-files` one final time.
4. Push the local default branch.
5. Create tag `v0.1.0` from the verified release commit and push the tag.
6. Create the GitHub Release using the prepared title and notes.
7. Confirm the repository description, topics and MIT license detection on GitHub.

Do not upload `public/flows/`, `dist/`, local build caches or internal audit material.
