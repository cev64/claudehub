import fs from 'node:fs';
import path from 'node:path';
import type { ActionResult, ProjectAction, Project } from '../../shared/types.ts';
import { git } from './git.ts';
import { run, truncate } from './util.ts';

const isMac = process.platform === 'darwin';

function tail(s: string): string {
  const lines = s.trim().split('\n').filter(Boolean);
  return truncate(lines.slice(-3).join(' | '), 300);
}

export async function runProjectAction(
  action: ProjectAction,
  project: Project,
  ctx: { editor: string; projectsDir: string },
): Promise<{ result: ActionResult; rescan: 'project' | 'all' | null }> {
  const fail = (message: string) => ({ result: { ok: false, message }, rescan: null });
  const local = project.local;

  if (action === 'clone') {
    if (local) return fail(`${project.name} is already cloned at ${local.path}.`);
    if (!project.github) return fail('This project has no GitHub repository to clone.');
    const dest = path.join(ctx.projectsDir, project.name);
    if (fs.existsSync(dest)) return fail(`${dest} already exists; not cloning over it.`);
    const r = await run('git', ['clone', '--', `${project.github.url}.git`, dest], { timeoutMs: 10 * 60_000 });
    if (!r.ok) return fail(`Clone failed: ${tail(r.stderr || r.error || '')}`);
    return { result: { ok: true, message: `Cloned into ${dest}.` }, rescan: 'all' };
  }

  if (!local) return fail(`${project.name} is not cloned on this Mac.`);

  switch (action) {
    case 'fetch': {
      const r = await git(local.path, ['fetch', '--all', '--prune'], 120_000);
      return r.ok
        ? { result: { ok: true, message: 'Fetched all remotes.' }, rescan: 'project' }
        : { result: { ok: false, message: `Fetch failed: ${tail(r.stderr || r.error || '')}` }, rescan: 'project' };
    }
    case 'pull': {
      const r = await git(local.path, ['pull', '--ff-only'], 120_000);
      return r.ok
        ? { result: { ok: true, message: tail(r.stdout) || 'Already up to date.' }, rescan: 'project' }
        : { result: { ok: false, message: `Pull failed: ${tail(r.stderr || r.error || '')}` }, rescan: 'project' };
    }
    case 'open-editor':
    case 'open-finder':
    case 'open-terminal': {
      if (!isMac) return fail(`"${action}" works only on macOS (this agent runs on ${process.platform}).`);
      const args =
        action === 'open-editor' ? ['-a', ctx.editor, local.path] : action === 'open-terminal' ? ['-a', 'Terminal', local.path] : [local.path];
      const r = await run('open', args, { timeoutMs: 15_000 });
      if (!r.ok) return fail(`Could not open: ${tail(r.stderr || r.error || '')}`);
      const what = action === 'open-editor' ? ctx.editor : action === 'open-terminal' ? 'Terminal' : 'Finder';
      return { result: { ok: true, message: `Opened in ${what}.` }, rescan: null };
    }
    default:
      return fail(`Unknown action: ${String(action)}`);
  }
}
