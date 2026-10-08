#!/usr/bin/env node
// ClaudeHub status line capture for Claude Code.
//
// Claude Code runs this as its `statusLine` command and pipes a JSON object to stdin. We save it
// under <CLAUDEHUB_HOME or ~/.claudehub>/statusline/ (so the ClaudeHub agent can show plan limits
// and context size), then print the status line text. If the user had a status line before, it is
// stored in statusline/chain.json and still runs, with its output shown unchanged.
//
// Plain Node ESM, no dependencies. Fast, never throws, always exits 0.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function home() {
  const env = process.env.CLAUDEHUB_HOME;
  if (env && env.trim()) {
    const e = env.trim();
    if (e === '~') return os.homedir();
    if (e.startsWith('~/')) return path.join(os.homedir(), e.slice(2));
    return e;
  }
  return path.join(os.homedir(), '.claudehub');
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    // If nothing ever arrives (run by hand without a pipe), do not hang forever.
    const timer = setTimeout(finish, 5000);
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
    process.stdin.resume();
  });
}

function pct(n) {
  return typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n)}%` : null;
}

function defaultLine(data) {
  if (!data || typeof data !== 'object') return '';
  const parts = [];
  const model = data.model?.display_name ?? data.model?.id;
  if (typeof model === 'string' && model) parts.push(model);

  const cw = data.context_window;
  let ctx = typeof cw?.used_percentage === 'number' ? cw.used_percentage : null;
  if (ctx === null && cw?.current_usage && typeof cw.context_window_size === 'number' && cw.context_window_size > 0) {
    const u = cw.current_usage;
    const used = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
    if (used > 0) ctx = (used / cw.context_window_size) * 100;
  }
  if (pct(ctx)) parts.push(`ctx ${pct(ctx)}`);

  const five = pct(data.rate_limits?.five_hour?.used_percentage);
  if (five) parts.push(`5h ${five}`);
  const week = pct(data.rate_limits?.seven_day?.used_percentage);
  if (week) parts.push(`wk ${week}`);
  return parts.join(' · ');
}

function save(data) {
  const dir = path.join(home(), 'statusline');
  const capturedAt = new Date().toISOString();
  const body = JSON.stringify({ capturedAt, data });
  writeAtomic(path.join(dir, 'latest.json'), body);

  const sid = typeof data?.session_id === 'string' ? data.session_id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) : '';
  if (sid && sid !== '.' && sid !== '..') writeAtomic(path.join(dir, 'sessions', `${sid}.json`), body);

  // Only touch limits.json when this payload carries rate_limits, so a session without them
  // (API-key login, or before the first response) does not erase the last known values.
  const rl = data?.rate_limits;
  if (rl && typeof rl === 'object' && (rl.five_hour || rl.seven_day)) {
    writeAtomic(path.join(dir, 'limits.json'), JSON.stringify({ capturedAt, rate_limits: rl }));
  }
}

function chained() {
  try {
    const file = path.join(home(), 'statusline', 'chain.json');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cmd = cfg && typeof cfg.command === 'string' ? cfg.command.trim() : '';
    if (!cmd || cmd.includes('statusline.mjs')) return null; // never chain into ourselves
    return { cmd };
  } catch {
    return null;
  }
}

async function main() {
  const raw = await readStdin();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* not JSON: still run the chain */ }

  if (data && typeof data === 'object') {
    try { save(data); } catch { /* never break the status line */ }
  }

  const chain = chained();
  if (chain) {
    try {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync('/bin/sh', ['-c', chain.cmd], {
        input: raw,
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      if (!r.error && typeof r.stdout === 'string' && r.stdout.length > 0) {
        process.stdout.write(r.stdout);
        return;
      }
    } catch { /* fall through to the default line */ }
  }

  const line = defaultLine(data);
  if (line) process.stdout.write(line + '\n');
}

// Let stdout flush naturally instead of calling process.exit().
process.exitCode = 0;
main().catch(() => { process.exitCode = 0; });
