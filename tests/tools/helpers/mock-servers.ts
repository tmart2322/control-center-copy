/** Local mock servers standing in for talk-track (NDJSON) and pulse-footprint (SSE). Loopback only. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseManifest, type ToolManifest } from '@/tools/manifest';

export interface Recorded { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }

export interface Mock {
  port: number;
  requests: Recorded[];
  close(): Promise<void>;
}

export async function startMock(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string, rec: Recorded[]) => void): Promise<Mock> {
  const requests: Recorded[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, res, body, requests);
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () => new Promise<void>((r) => { sockets.forEach((s) => s.destroy()); server.close(() => r()); }),
  };
}

export const json = (res: http.ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

/** A port nothing is listening on. */
export async function closedPort(): Promise<number> {
  const m = await startMock(() => {});
  const p = m.port;
  await m.close();
  return p;
}

const REG = path.resolve(__dirname, '../../../tools-registry');
export const readManifestFile = (id: string): unknown => JSON.parse(readFileSync(path.join(REG, `${id}.json`), 'utf8'));

/** Real manifest with its localhost:<port> rewritten to a mock port. */
export function manifestOnPort(id: string, from: number, to: number): ToolManifest {
  const text = JSON.stringify(readManifestFile(id)).replaceAll(`localhost:${from}`, `127.0.0.1:${to}`).replace(`"port":${from}`, `"port":${to}`);
  return parseManifest(JSON.parse(text));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
