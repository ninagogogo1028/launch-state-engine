// Launch Truth (public/flows/) is per-user runtime state: Product Context,
// statuses, blockers and evidence. Vite copies public/ verbatim into the
// client build output, which would turn that data into publicly deployable
// static files. This build-only plugin removes the runtime data directories
// from every build output after the bundle is written. Storage paths and the
// dev server are unchanged.
import { rm } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

// public/evidence/ was written by older LSE versions (see .gitignore).
export const LAUNCH_TRUTH_PUBLIC_DIRS = ["flows", "evidence"];

export async function removeLaunchTruthFromOutput(outDir: string) {
  for (const dir of LAUNCH_TRUTH_PUBLIC_DIRS) {
    await rm(path.join(outDir, dir), { recursive: true, force: true });
  }
}

export function excludeLaunchTruthFromBuild(): Plugin {
  return {
    name: "lse-exclude-launch-truth",
    apply: "build",
    async writeBundle(options) {
      if (options.dir) await removeLaunchTruthFromOutput(options.dir);
    },
  };
}
