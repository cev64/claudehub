import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { JobStreamMessage, NewJobRequest, NewProjectRequest, Settings } from '../../shared/types.ts';
import { Hub, HttpError, VERSION } from './hub.ts';
import { isFinished } from './jobs.ts';
import { errMsg, isLoopback, log, warn } from './util.ts';
import { dataDir } from './config.ts';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 4317;
const TOKEN = process.env.CLAUDEHUB_TOKEN || '';
const WEB_DIR = path.resolve(import.meta.dirname, '../../dist/web');

const hub = new Hub();
const app = Fastify({ logger: false, bodyLimit: 1_000_000 });

// Tolerate empty JSON bodies (POST /api/refresh with a JSON content type).
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try {
    const text = String(body).trim();
    done(null, text ? JSON.parse(text) : {});
  } catch {
    done(new HttpError(400, 'Invalid JSON body'), undefined);
  }
});

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

app.addHook('onRequest', async (req, reply) => {
  if (!TOKEN || !req.url.startsWith('/api')) return;
  // A loopback peer that carries forwarding headers is a reverse proxy (e.g. tailscale serve), not a local user.
  const proxied = Boolean(req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']);
  if (isLoopback(req.ip) && !proxied) return;
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const query = typeof (req.query as Record<string, unknown>)?.token === 'string' ? ((req.query as Record<string, string>).token) : '';
  if ((bearer && safeEqual(bearer, TOKEN)) || (query && safeEqual(query, TOKEN))) return;
  return reply.code(401).send({ error: 'Unauthorized: send Authorization: Bearer <token>' });
});

app.setErrorHandler((err, _req, reply) => {
  const status = err instanceof HttpError ? err.status : (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) warn('request error:', errMsg(err));
  reply.code(status).send({ error: errMsg(err) });
});

// -- API ---------------------------------------------------------------------------------
app.get('/api/health', async () => hub.health());
app.get('/api/overview', async () => hub.overview());
app.get('/api/projects', async () => hub.snapshot.projects);
app.post('/api/projects', async (req) => hub.createProject((req.body ?? {}) as NewProjectRequest));

app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
  const d = await hub.detail(req.params.id);
  if (!d) throw new HttpError(404, 'Unknown project');
  return d;
});
app.post<{ Params: { id: string }; Body: { action?: string } }>('/api/projects/:id/actions', async (req) =>
  hub.action(req.params.id, String(req.body?.action ?? '')),
);

app.get<{ Querystring: { state?: string } }>('/api/pulls', async (req) => {
  const all = req.query.state === 'all';
  return hub.snapshot.pulls.filter((p) => all || p.state === 'open');
});

app.post('/api/refresh', async () => {
  void hub.refresh();
  return { ok: true };
});

app.get('/api/jobs', async () => hub.jobs.list());
app.post('/api/jobs', async (req) => hub.createJob((req.body ?? {}) as NewJobRequest));
app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req) => {
  const j = hub.jobs.getWithEvents(req.params.id);
  if (!j) throw new HttpError(404, 'Unknown job');
  return j;
});
app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (req) => {
  const j = hub.jobs.cancel(req.params.id);
  if (!j) throw new HttpError(404, 'Unknown job');
  return j;
});

app.get<{ Params: { id: string } }>('/api/jobs/:id/stream', (req, reply) => {
  const job = hub.jobs.get(req.params.id);
  if (!job) return reply.code(404).send({ error: 'Unknown job' });
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (msg: JobStreamMessage) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
  let closed = false;
  let unsub: () => void = () => {};
  let ping: NodeJS.Timeout | undefined;
  const end = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    unsub();
    res.end();
  };
  req.raw.on('close', end);

  for (const event of hub.jobs.readEvents(job.id)) send({ kind: 'event', event });
  const current = hub.jobs.get(job.id)!;
  send({ kind: 'status', job: current });
  if (isFinished(current.status)) return end();
  unsub = hub.jobs.subscribe(job.id, (msg) => {
    if (closed) return;
    send(msg);
    if (msg.kind === 'status' && isFinished(msg.job.status)) end();
  });
  ping = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 20_000);
});

app.post('/api/suggestions/ai', async () => {
  try {
    return await hub.aiSuggest();
  } catch (e) {
    throw new HttpError(502, errMsg(e));
  }
});

app.get('/api/settings', async () => hub.getSettings());
app.put<{ Body: Partial<Settings> }>('/api/settings', async (req) => hub.updateSettings(req.body ?? {}));

// -- static web + SPA fallback -----------------------------------------------------------
const hasWeb = fs.existsSync(path.join(WEB_DIR, 'index.html'));
const MISSING_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClaudeHub</title>
<body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div><h1>ClaudeHub agent is running</h1><p>The web app is not built yet. Run <code>npm run build</code>, then reload.</p></div></body>`;

if (hasWeb) {
  await app.register(fastifyStatic, { root: WEB_DIR, wildcard: false });
}
app.setNotFoundHandler((req, reply) => {
  if (req.method === 'GET' && !req.url.startsWith('/api')) {
    if (hasWeb) {
      const file = req.url.split('?')[0];
      // Real file requests that miss (assets) should 404 rather than return the app shell.
      if (path.extname(file)) return reply.code(404).send('Not found');
      return reply.type('text/html').send(fs.readFileSync(path.join(WEB_DIR, 'index.html')));
    }
    return reply.type('text/html').send(MISSING_HTML);
  }
  reply.code(404).send({ error: 'Not found' });
});

// -- start -------------------------------------------------------------------------------
async function main() {
  await app.listen({ host: HOST, port: PORT });
  log(`ClaudeHub agent v${VERSION} listening on http://${HOST}:${PORT}`);
  log(`data dir ${dataDir()} · projects dir ${hub.settings.projectsDir} (depth ${hub.settings.scanDepth})`);
  log(hasWeb ? `serving web app from ${WEB_DIR}` : 'web app not built (run: npm run build)');
  if (!isLoopback(HOST) && HOST !== 'localhost') {
    if (!TOKEN) {
      warn('!!! HOST is not loopback and CLAUDEHUB_TOKEN is not set: anyone who can reach this port can run Claude on your Mac. Set CLAUDEHUB_TOKEN. !!!');
    } else log('token auth enabled for non-loopback requests');
  }
  hub.start();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log(`${sig} received, shutting down`);
    hub.stop();
    void app.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

main().catch((e) => {
  console.error('fatal:', errMsg(e));
  process.exit(1);
});
