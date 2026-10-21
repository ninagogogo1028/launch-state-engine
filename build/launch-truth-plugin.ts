// Dev-server side of the shared Launch Truth. The dashboard and the
// launch-state CLI must read and write the same store file
// (public/flows/launch-state.json) with the same lib/launch-store semantics.
// The browser cannot touch the filesystem, and vinext executes app code in
// workerd even under `vite dev`, so the write handle lives here instead: a
// small Node middleware on the Vite dev server. It exposes the /api/launch-state
// contract implemented in lib/launch-truth-api.ts and is absent from
// production builds, where the launch-state CLI remains the write path.
//
// This is a local development API with no authentication. It enforces the
// human/agent channel contract; it is not a tamper-resistant security boundary.
import type { Plugin } from "vite";
import { handleTruthRequest, truthView } from "../lib/launch-truth-api";

function send(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function launchTruth(): Plugin {
  return {
    name: "lse-launch-truth",
    configureServer(server) {
      server.middlewares.use("/api/launch-state", (req, res) => {
        void (async () => {
          const root = server.config.root;
          try {
            if (req.method === "GET") {
              send(res, 200, { ok: true, ...(await truthView(root)) });
              return;
            }
            if (req.method !== "POST") {
              send(res, 405, { ok: false, kind: "invalid_request", error: "method not allowed" });
              return;
            }
            let payload: unknown;
            try {
              payload = JSON.parse(await readBody(req));
            } catch {
              send(res, 400, { ok: false, kind: "invalid_request", error: "Request body must be JSON." });
              return;
            }
            const response = await handleTruthRequest(root, payload);
            send(res, response.status, response.body);
          } catch (err) {
            send(res, 500, { ok: false, kind: "write_failed", error: err instanceof Error ? err.message : String(err) });
          }
        })();
      });
    },
  };
}
