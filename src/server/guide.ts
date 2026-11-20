/**
 * Server helpers for the in-app guide: the README for ⌘K ▸ Read the README. Read-only, from the folder the app
 * runs in (the repository checkout).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReadmePayload } from '@/contract';
import { notFound } from '@/server/errors';

export async function readReadme(root: string = process.cwd()): Promise<ReadmePayload> {
  const file = path.join(root, 'README.md');
  try {
    return { markdown: await readFile(file, 'utf8'), path: 'README.md' };
  } catch {
    throw notFound('README', 'README.md');
  }
}
