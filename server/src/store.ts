import fs from 'node:fs';
import { dataPath } from './config.ts';
import { warn } from './util.ts';

export function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(dataPath(name), 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn(`could not read ${name}:`, (e as Error).message);
    return null;
  }
}

export function writeJson(name: string, value: unknown): void {
  try {
    const file = dataPath(name);
    fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(value));
    fs.renameSync(file + '.tmp', file);
  } catch (e) {
    warn(`could not write ${name}:`, (e as Error).message);
  }
}
