import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { JobEvent } from '../../shared/types.ts';
import type { HealthCheck } from '../../shared/types.ts';
import { claudeEnv, findBinary, run, truncate, errMsg } from './util.ts';

export function resolveClaudeBin(): string | null {
  const envBin = process.env.CLAUDE_BIN?.trim();
  if (envBin) return envBin;
  const home = os.homedir();
  return findBinary('claude', [
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]);
}

export const CLAUDE_MISSING = 'Claude CLI not found. Install Claude Code (https://claude.ai/code) or set CLAUDE_BIN.';

// ---------------------------------------------------------------------------------------------
// stream-json parsing (pure; unit-testable)

export type PartialEvent = Omit<JobEvent, 'ts'>;

export interface ParsedLine {
  events: PartialEvent[];
  sessionId?: string;
  result?: { ok: boolean; text: string | null; error: string | null };
}

export function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  for (const k of ['file_path', 'command', 'pattern', 'path', 'url', 'query', 'description', 'prompt', 'notebook_path']) {
    if (typeof o[k] === 'string' && o[k]) return truncate(o[k] as string, 160);
  }
  const first = Object.values(o).find((v) => typeof v === 'string' && v);
  return first ? truncate(first as string, 160) : '';
}

export function parseStreamLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (!trimmed) return { events: [] };
  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return { events: [{ type: 'system', text: truncate(trimmed, 1000) }] };
  }
  if (!msg || typeof msg !== 'object') return { events: [{ type: 'system', text: truncate(trimmed, 1000) }] };

  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') {
        const sid = typeof msg.session_id === 'string' ? msg.session_id : undefined;
        const bits = [sid ? `session ${sid.slice(0, 8)}` : null, msg.model ? String(msg.model) : null].filter(Boolean);
        return { events: [{ type: 'system', text: `Started${bits.length ? ' · ' + bits.join(' · ') : ''}` }], sessionId: sid };
      }
      return { events: [] };
    }
    case 'assistant': {
      if (msg.parent_tool_use_id) return { events: [] }; // subagent chatter
      const content = msg.message?.content;
      const events: PartialEvent[] = [];
      if (typeof content === 'string') {
        if (content.trim()) events.push({ type: 'text', text: content.trim() });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            events.push({ type: 'text', text: block.text.trim() });
          } else if (block?.type === 'tool_use') {
            events.push({ type: 'tool', tool: String(block.name ?? 'tool'), text: summarizeToolInput(block.input) });
          }
        }
      }
      return { events, sessionId: typeof msg.session_id === 'string' ? msg.session_id : undefined };
    }
    case 'result': {
      const sid = typeof msg.session_id === 'string' ? msg.session_id : undefined;
      const errors: string[] = Array.isArray(msg.errors) ? msg.errors.map(String) : [];
      const ok = msg.subtype === 'success' && !msg.is_error;
      const text = typeof msg.result === 'string' ? msg.result : null;
      const error = ok ? null : errors.join('; ') || text || String(msg.subtype ?? 'error');
      const shown = ok ? text ?? 'Done' : error!;
      return { events: [{ type: 'result', text: shown }], sessionId: sid, result: { ok, text: ok ? text : text, error } };
    }
    default:
      return { events: [] }; // user (tool results), rate_limit_event, etc.
  }
}

// ---------------------------------------------------------------------------------------------
// one-shot JSON runs (AI suggestions)

export interface JsonRunResult { text: string | null; structured: unknown; raw: unknown }

export function runClaudeJson(
  prompt: string,
  opts: { cwd: string; model?: string; schema?: object; timeoutMs?: number },
): Promise<JsonRunResult> {
  const bin = resolveClaudeBin();
  if (!bin) return Promise.reject(new Error(CLAUDE_MISSING));
  const args = ['-p', ' ' + prompt, '--permission-mode', 'plan', '--output-format', 'json'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.schema) args.push('--json-schema', JSON.stringify(opts.schema));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let err = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      finish(() => reject(new Error('Claude took too long (timed out).')));
    }, opts.timeoutMs ?? 300_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish(() => reject(new Error(`Could not start claude: ${errMsg(e)}`))));
    child.on('close', (code) =>
      finish(() => {
        let parsed: any = null;
        try { parsed = JSON.parse(out); } catch { /* maybe NDJSON / array */ }
        if (Array.isArray(parsed)) parsed = [...parsed].reverse().find((m) => m?.type === 'result') ?? null;
        if (!parsed) {
          const lines = out.split('\n').filter(Boolean).reverse();
          for (const l of lines) {
            try { const m = JSON.parse(l); if (m?.type === 'result') { parsed = m; break; } } catch { /* next */ }
          }
        }
        if (!parsed) return reject(new Error(code === 0 ? 'Claude returned no JSON.' : `claude exited with code ${code}: ${truncate(err || out, 300)}`));
        if (parsed.is_error) return reject(new Error(truncate(String(parsed.result ?? parsed.subtype ?? 'Claude reported an error'), 300)));
        resolve({ text: typeof parsed.result === 'string' ? parsed.result : null, structured: parsed.structured_output ?? null, raw: parsed });
      }),
    );
  });
}

/** First top-level JSON object in a string (tolerates code fences and prose around it). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// health

let healthCache: { at: number; value: HealthCheck } | null = null;

export async function claudeHealth(): Promise<HealthCheck> {
  if (healthCache && Date.now() - healthCache.at < 60_000) return healthCache.value;
  const value = await computeClaudeHealth();
  healthCache = { at: Date.now(), value };
  return value;
}

async function computeClaudeHealth(): Promise<HealthCheck> {
  const bin = resolveClaudeBin();
  if (!bin) return { ok: false, detail: `${CLAUDE_MISSING} Install: npm i -g @anthropic-ai/claude-code` };
  const env = claudeEnv();
  const v = await run(bin, ['--version'], { timeoutMs: 15_000, env });
  if (!v.ok) return { ok: false, detail: `Claude CLI at ${bin} did not run: ${truncate(v.stderr || v.error || '', 120)}` };
  const version = (/\d+\.\d+\.\d+\S*/.exec(v.stdout)?.[0]) ?? v.stdout.trim().split('\n')[0];
  const a = await run(bin, ['auth', 'status'], { timeoutMs: 15_000, env });
  let info: any = null;
  try { info = JSON.parse(a.stdout); } catch { /* fall back */ }
  if (info && typeof info === 'object') {
    const method = String(info.authMethod ?? info.method ?? '');
    const loggedIn = a.ok && info.loggedIn !== false;
    if (!loggedIn) return { ok: false, detail: `Not logged in — run: claude, then /login (CLI ${version})` };
    if (method === 'api_key') {
      return { ok: true, detail: `Logged in with an API key, which overrides the subscription — remove it to use your Claude plan · ${version}` };
    }
    return { ok: true, detail: `Logged in${method ? ` (${method})` : ''} · ${version}` };
  }
  if (!a.ok && a.code === 1) return { ok: false, detail: `Not logged in — run: claude, then /login (CLI ${version})` };
  return { ok: true, detail: `Claude CLI ${version} (login status unknown)` };
}
