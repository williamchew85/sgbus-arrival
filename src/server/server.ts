import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { Poller, CacheSnapshot, StopCacheEntry } from '../poller/poller.ts';

import type { ServiceArrivals } from '../lta/types.ts';

/** Public (secret-free) view of a stop for the API. */
interface ApiStop {
  busStopCode: string;
  name: string;
  stale: boolean;
  lastUpdated: number | null;
  services: ServiceArrivals[];
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export interface ServerOptions {
  poller: Poller;
  /** Absolute path to the static display directory. */
  publicDir: string;
}

/** Shape one cache entry into a secret-free API object. */
function toApiStop(entry: StopCacheEntry): Record<string, unknown> {
  return {
    busStopCode: entry.busStopCode,
    name: entry.name,
    stale: entry.stale,
    lastUpdated: entry.lastUpdated,
    // `data` already contains only transformed, public arrival info.
    services: entry.data?.services ?? [],
  };
}

function toApiSnapshot(snap: CacheSnapshot): Record<string, unknown> {
  return {
    lastUpdated: snap.lastUpdated,
    anyStale: snap.anyStale,
    stops: snap.stops.map(toApiStop),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

/** Build (but do not start) the HTTP handler + server. */
export function buildServer(opts: ServerOptions) {
  const { poller, publicDir } = opts;
  const root = resolve(publicDir);

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    // --- API routes -------------------------------------------------------
    if (path === '/api/arrivals') {
      sendJson(res, 200, toApiSnapshot(poller.snapshot()));
      return;
    }
    const stopMatch = /^\/api\/arrivals\/(\d{5})$/.exec(path);
    if (stopMatch) {
      const entry = poller.getStop(stopMatch[1]!);
      if (entry === undefined) {
        sendJson(res, 404, { error: `unknown stop ${stopMatch[1]}` });
        return;
      }
      sendJson(res, 200, toApiStop(entry));
      return;
    }
    if (path === '/healthz') {
      const snap = poller.snapshot();
      sendJson(res, 200, {
        ok: true,
        lastUpdated: snap.lastUpdated,
        anyStale: snap.anyStale,
        stops: snap.stops.map((s) => ({ code: s.busStopCode, stale: s.stale })),
      });
      return;
    }

    // --- Static display assets -------------------------------------------
    await serveStatic(root, path, res);
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
      console.error('[server] request error:', err);
    });
  });

  return { server, handler };
}

/** Serve a static file from `root`, guarding against path traversal. */
async function serveStatic(
  root: string,
  reqPath: string,
  res: ServerResponse,
): Promise<void> {
  const rel = reqPath === '/' ? '/index.html' : reqPath;
  // Resolve and ensure the result stays under root (no "../" escape).
  const filePath = normalize(join(root, rel));
  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  try {
    const content = await readFile(filePath);
    const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

export type { ApiStop };
