import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { FavaroCache } from "@favaro/core";
import { formatMetricsForOpenTelemetry } from "@favaro/core";

export interface DashboardOptions {
  port?: number;
  host?: string;
  cache: FavaroCache;
}

export interface DashboardServer {
  url: string;
  close(): Promise<void>;
}

export function createDashboard(options: DashboardOptions): DashboardServer {
  const port = options.port ?? 3847;
  const host = options.host ?? "127.0.0.1";
  const cache = options.cache;

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, cache);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Internal error" });
    }
  });

  server.listen(port, host);

  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cache: FavaroCache
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    sendHtml(res, renderDashboard(await getDashboardData(cache)));
    return;
  }

  if (url.pathname === "/api/metrics") {
    const metrics = cache.getMetrics();
    sendJson(res, 200, metrics ?? {});
    return;
  }

  if (url.pathname === "/api/keys") {
    const pattern = url.searchParams.get("pattern") ?? undefined;
    const keys = await cache.keys(undefined, pattern ?? undefined);
    sendJson(res, 200, { keys, count: keys.length });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { status: "ok", namespace: cache.namespace });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function getDashboardData(cache: FavaroCache) {
  const metrics = cache.getMetrics();
  const size = await cache.size();
  const keys = await cache.keys();
  const hitRatio =
    metrics && metrics.hits + metrics.misses > 0
      ? ((metrics.hits / (metrics.hits + metrics.misses)) * 100).toFixed(1)
      : "0.0";

  return { metrics, size, keys: keys.slice(0, 50), hitRatio, otel: metrics ? formatMetricsForOpenTelemetry(metrics) : {} };
}

function renderDashboard(data: Awaited<ReturnType<typeof getDashboardData>>): string {
  const m = data.metrics;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Favaro Cache Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e4e4e7; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #fafafa; }
    .subtitle { color: #71717a; margin-bottom: 2rem; font-size: 0.875rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 1.25rem; }
    .card .label { font-size: 0.75rem; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.05em; }
    .card .value { font-size: 1.75rem; font-weight: 600; margin-top: 0.25rem; color: #fafafa; }
    .card .value.green { color: #4ade80; }
    .card .value.blue { color: #60a5fa; }
    .card .value.yellow { color: #facc15; }
    table { width: 100%; border-collapse: collapse; background: #18181b; border-radius: 8px; overflow: hidden; border: 1px solid #27272a; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #27272a; font-size: 0.875rem; }
    th { background: #1c1c22; color: #a1a1aa; font-weight: 500; }
    td { font-family: 'SF Mono', 'Fira Code', monospace; color: #d4d4d8; word-break: break-all; }
    h2 { font-size: 1.125rem; margin-bottom: 1rem; color: #fafafa; }
    .refresh { color: #71717a; font-size: 0.75rem; }
  </style>
</head>
<body>
  <h1>Favaro LLM Cache</h1>
  <p class="subtitle">Local cache dashboard &middot; Auto-refreshes every 5s</p>

  <div class="grid">
    <div class="card"><div class="label">Hit Ratio</div><div class="value green">${data.hitRatio}%</div></div>
    <div class="card"><div class="label">Entries</div><div class="value blue">${data.size}</div></div>
    <div class="card"><div class="label">Hits</div><div class="value">${m?.hits ?? 0}</div></div>
    <div class="card"><div class="label">Misses</div><div class="value">${m?.misses ?? 0}</div></div>
    <div class="card"><div class="label">Deduplicated</div><div class="value yellow">${m?.deduplicated ?? 0}</div></div>
    <div class="card"><div class="label">Saved Tokens</div><div class="value green">${m?.savedTokens ?? 0}</div></div>
    <div class="card"><div class="label">Saved Cost</div><div class="value green">$${(m?.savedCost ?? 0).toFixed(4)}</div></div>
    <div class="card"><div class="label">Memory</div><div class="value">${((m?.memoryUsageBytes ?? 0) / 1024).toFixed(1)} KB</div></div>
  </div>

  <h2>Cache Keys</h2>
  <table>
    <thead><tr><th>Key</th></tr></thead>
    <tbody>
      ${data.keys.length > 0 ? data.keys.map((k) => `<tr><td>${escapeHtml(k)}</td></tr>`).join("") : '<tr><td style="color:#71717a">No entries</td></tr>'}
    </tbody>
  </table>
  <p class="refresh" style="margin-top:1rem">Last updated: ${new Date().toLocaleTimeString()}</p>
  <script>setTimeout(() => location.reload(), 5000);</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

export { createDashboard as startDashboard };
