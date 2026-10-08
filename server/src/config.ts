import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Settings } from '../../shared/types.ts';
import { expandHome, warn } from './util.ts';

export function dataDir(): string {
  const dir = process.env.CLAUDEHUB_HOME ? expandHome(process.env.CLAUDEHUB_HOME) : path.join(os.homedir(), '.claudehub');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataPath(...parts: string[]): string {
  return path.join(dataDir(), ...parts);
}

export type StoredSettings = Omit<Settings, 'githubUser'>;

export function defaults(): StoredSettings {
  return {
    projectsDir: path.join(os.homedir(), 'Desktop'),
    scanDepth: 2,
    editor: 'Visual Studio Code',
    refreshMinutes: 5,
    defaultModel: null,
  };
}

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

export function sanitize(input: Partial<StoredSettings>, base: StoredSettings): StoredSettings {
  const out = { ...base };
  if (typeof input.projectsDir === 'string' && input.projectsDir.trim()) {
    out.projectsDir = path.resolve(expandHome(input.projectsDir.trim()));
  }
  if (input.scanDepth !== undefined) out.scanDepth = clamp(input.scanDepth, 1, 3, base.scanDepth);
  if (typeof input.editor === 'string' && input.editor.trim() && !input.editor.trim().startsWith('-')) {
    out.editor = input.editor.trim();
  }
  if (input.refreshMinutes !== undefined) out.refreshMinutes = clamp(input.refreshMinutes, 1, 1440, base.refreshMinutes);
  if (input.defaultModel !== undefined) {
    out.defaultModel = typeof input.defaultModel === 'string' && input.defaultModel.trim() ? input.defaultModel.trim() : null;
  }
  return out;
}

export function loadSettings(): StoredSettings {
  const base = defaults();
  let stored: Partial<StoredSettings> = {};
  try {
    stored = JSON.parse(fs.readFileSync(dataPath('config.json'), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn('could not read config.json:', (e as Error).message);
  }
  let s = sanitize(stored, base);
  if (process.env.PROJECTS_DIR) s = sanitize({ projectsDir: process.env.PROJECTS_DIR }, s);
  return s;
}

export function saveSettings(s: StoredSettings): void {
  const file = dataPath('config.json');
  // When PROJECTS_DIR env overrides, still persist what the user chose in the UI.
  fs.writeFileSync(file + '.tmp', JSON.stringify(s, null, 2));
  fs.renameSync(file + '.tmp', file);
}
