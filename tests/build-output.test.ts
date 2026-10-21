import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeLaunchTruthFromOutput } from "../build/exclude-launch-truth.ts";

test("build output never contains per-user Launch Truth copied from public/", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "lse-build-test-"));
  try {
    await mkdir(path.join(outDir, "flows", "launch-cases"), { recursive: true });
    await writeFile(path.join(outDir, "flows", "launch-state.json"), "{}");
    await writeFile(path.join(outDir, "flows", "launch-cases", "p--wechat-launch.json"), "{}");
    await mkdir(path.join(outDir, "evidence"));
    await writeFile(path.join(outDir, "evidence", "old.json"), "{}");
    await mkdir(path.join(outDir, "_next"));
    await writeFile(path.join(outDir, "favicon.svg"), "<svg/>");

    await removeLaunchTruthFromOutput(outDir);

    assert.deepEqual((await readdir(outDir)).sort(), ["_next", "favicon.svg"]);
    // Idempotent when nothing is left to remove.
    await removeLaunchTruthFromOutput(outDir);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
