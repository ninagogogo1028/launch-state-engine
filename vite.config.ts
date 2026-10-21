import vinext from "vinext";
import { defineConfig } from "vite";
import { launchTruth } from "./build/launch-truth-plugin";
import { excludeLaunchTruthFromBuild } from "./build/exclude-launch-truth";

export default defineConfig(async () => {
  // The dashboard is served through vinext on the Cloudflare Vite plugin
  // (workerd). Keep its tool state project-local and offline: no metrics, no
  // Request.cf fetching, logs under the ignored .wrangler/ directory.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    plugins: [
      vinext(),
      // Local Launch Truth read/write API for the dashboard (dev server only).
      launchTruth(),
      // Keep per-user Launch Truth (public/flows/) out of build output.
      excludeLaunchTruthFromBuild(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          name: "launch-state-engine",
          main: "./build/worker.ts",
          compatibility_date: "2026-05-15",
          compatibility_flags: ["nodejs_compat"],
        },
      }),
    ],
  };
});
