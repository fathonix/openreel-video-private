import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { JobRunner } from "@openreel/agent";
import { runWorkerTask, WORKER_TASKS } from "./workers";
import type { WorkerTaskContext } from "./workers";

const PORT = Number(process.env.OPENREEL_DEV_GPU_PORT ?? 8000);

interface DevJob {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  message?: string;
  error?: string;
  manifestURL?: string;
  data?: Record<string, unknown>;
  artifacts: Map<string, Uint8Array>;
  createdAt: number;
}

interface DevMedia {
  bytes: Uint8Array;
  contentType?: string;
}

const jobs = new Map<string, DevJob>();
const media = new Map<string, DevMedia>();

const devRunner: JobRunner = async (kind) => ({
  ok: false,
  error: `kind ${kind} is not implemented in the local dev GPU worker (no cloud GPU worker configured)`,
});

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bundle-ID",
    "Access-Control-Max-Age": "600",
  });
  res.end(payload);
}

function bytes(res: ServerResponse, status: number, body: Uint8Array, contentType: string): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bundle-ID",
  });
  res.end(Buffer.from(body));
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Uint8Array);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function parseJobBody(body: Uint8Array): {
  kind: string;
  params: Record<string, unknown>;
  mediaKey?: string;
} {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  } catch {
    throw new Error("invalid JSON body");
  }
  const request = (raw.request ?? raw) as Record<string, unknown>;
  const kind = typeof request.kind === "string" ? request.kind : "";
  const params =
    request.params && typeof request.params === "object"
      ? (request.params as Record<string, unknown>)
      : {};
  const mediaKey = typeof raw.mediaKey === "string" ? raw.mediaKey : undefined;
  return { kind, params, mediaKey };
}

async function runJob(job: DevJob, ctx: WorkerTaskContext): Promise<void> {
  job.status = "processing";
  try {
    const result = await runWorkerTask(job.kind, job.params, ctx);
    if (result.ok) {
      const data = (result.data ?? {}) as Record<string, unknown>;
      const { vtt, ...metadata } = data;
      if (typeof vtt === "string") {
        job.artifacts.set("transcript.vtt", new TextEncoder().encode(vtt));
      }
      job.data = metadata;
      job.status = "completed";
    } else {
      job.status = "failed";
      job.error = result.error ?? "worker failed";
    }
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
  }
}

function requestHandler(ctx: WorkerTaskContext) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const base = `http://${req.headers.host ?? `localhost:${PORT}`}`;
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bundle-ID",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/health") {
      json(res, 200, {
        status: "ok",
        worker: "openreel-dev-gpu-worker",
        kinds: Object.keys(WORKER_TASKS),
        activeJobs: jobs.size,
      });
      return;
    }

    if (path === "/auth/challenge" && req.method === "POST") {
      json(res, 200, { challengeId: randomUUID() });
      return;
    }

    if (path === "/auth/token" && req.method === "POST") {
      json(res, 200, {
        token: `dev.${Buffer.from(randomUUID()).toString("base64url")}`,
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      return;
    }

    if (path === "/auth/upload-url" && req.method === "POST") {
      const key = `dev-${randomUUID()}`;
      json(res, 200, {
        uploadURL: `${base}/media/${key}`,
        mediaKey: key,
        headers: {},
      });
      return;
    }

    const mediaMatch = path.match(/^\/media\/(.+)$/);
    if (mediaMatch) {
      const key = decodeURIComponent(mediaMatch[1]);
      if (req.method === "PUT") {
        const body = await readBody(req);
        media.set(key, { bytes: body });
        json(res, 200, { mediaKey: key });
        return;
      }
      if (req.method === "GET") {
        const entry = media.get(key);
        if (!entry) {
          json(res, 404, { error: "media not found" });
          return;
        }
        bytes(res, 200, entry.bytes, entry.contentType ?? "application/octet-stream");
        return;
      }
    }

    if (path === "/jobs" && req.method === "POST") {
      let parsed: { kind: string; params: Record<string, unknown>; mediaKey?: string };
      try {
        parsed = parseJobBody(await readBody(req));
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (!(parsed.kind in WORKER_TASKS)) {
        json(res, 400, { error: `unknown GPU kind: ${parsed.kind}` });
        return;
      }
      const params: Record<string, unknown> = { ...parsed.params };
      if (parsed.mediaKey && media.has(parsed.mediaKey)) {
        params.mediaUrl = `${base}/media/${parsed.mediaKey}`;
      } else if (parsed.mediaKey) {
        json(res, 400, { error: `media ${parsed.mediaKey} not found locally` });
        return;
      }
      const job: DevJob = {
        id: randomUUID(),
        kind: parsed.kind,
        status: "queued",
        params,
        artifacts: new Map(),
        createdAt: Date.now(),
      };
      jobs.set(job.id, job);
      job.manifestURL = `${base}/jobs/${job.id}/manifest`;
      void runJob(job, ctx);
      json(res, 200, { jobID: job.id, status: job.status });
      return;
    }

    const jobMatch = path.match(/^\/jobs\/([^/]+)(?:\/(.*))?$/);
    if (jobMatch) {
      const jobID = decodeURIComponent(jobMatch[1]);
      const rest = jobMatch[2] ?? "";
      const job = jobs.get(jobID);
      if (!job) {
        json(res, 404, { error: "job not found" });
        return;
      }
      if (req.method === "GET" && rest === "") {
        json(res, 200, {
          jobID: job.id,
          status: job.status,
          message: job.message,
          error: job.error,
          manifestURL: job.manifestURL,
        });
        return;
      }
      if (req.method === "GET" && rest === "manifest") {
        json(res, 200, {
          jobID: job.id,
          kind: job.kind,
          status: job.status,
          artifacts: Array.from(job.artifacts.keys()).map((relativePath) => ({ relativePath })),
          metadata: job.data ?? {},
        });
        return;
      }
      if (req.method === "GET" && rest.startsWith("artifacts/")) {
        const relativePath = decodeURIComponent(rest.slice("artifacts/".length));
        const artifact = job.artifacts.get(relativePath);
        if (!artifact) {
          json(res, 404, { error: "artifact not found" });
          return;
        }
        const contentType = relativePath.endsWith(".vtt") ? "text/vtt" : "application/octet-stream";
        bytes(res, 200, artifact, contentType);
        return;
      }
      if (req.method === "DELETE" && rest === "") {
        if (job.status === "queued" || job.status === "processing") {
          job.status = "cancelled";
        }
        json(res, 200, { jobID: job.id, status: job.status });
        return;
      }
    }

    json(res, 404, { error: "not found" });
  };
}

export function startDevServer(
  options: { port?: number; ctx?: WorkerTaskContext } = {},
): ReturnType<typeof createServer> {
  const port = options.port ?? PORT;
  const ctx =
    options.ctx ??
    ({
      runner: devRunner,
      fetchFn: fetch,
    } satisfies WorkerTaskContext);
  const server = createServer(requestHandler(ctx));
  server.listen(port, () => {
    console.log(`[dev-gpu-worker] listening on http://localhost:${port}`);
    console.log(`[dev-gpu-worker] kinds: ${Object.keys(WORKER_TASKS).join(", ")}`);
  });
  return server;
}

if (process.argv[1] && process.argv[1].endsWith("dev-server.js")) {
  startDevServer();
}