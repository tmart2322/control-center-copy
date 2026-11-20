import { createHash } from 'node:crypto';
import type { Cursor } from '@/scanner/types';

export const sha1 = (...parts: Array<string | number | undefined | null>): string =>
  createHash('sha1')
    .update(parts.map((p) => (p === undefined || p === null ? '' : String(p))).join('\u0000'))
    .digest('hex');

/** Stable short hash (first 16 hex chars) used for content hashes. */
export const h16 = (...parts: Array<string | number | undefined | null>): string => sha1(...parts).slice(0, 16);

export const normalizeText = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim();

export const truncate = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s);

/** Clock injection so tests are deterministic. */
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

export function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout: ${label} after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/** Serializes async work (the devbar bridge allows one in-flight call: brief 09 §5.9). */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

// ---- Cursor encoding: Cursor.value is an opaque string; our fetchers keep JSON in it. ----

export function encodeCursor<T>(state: T, at: string): Cursor {
  return { value: JSON.stringify(state), at };
}

export function decodeCursor<T>(cursor: Cursor | null | undefined, fallback: T): T {
  if (!cursor?.value) return fallback;
  try {
    const parsed = JSON.parse(cursor.value) as T;
    return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
  } catch {
    return fallback;
  }
}

// ---- HTML to text (Gmail bodies sometimes come back as raw HTML) ----

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n').replace(/<\/t[dh]>/gi, ' ');
  s = s.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    return text && !href.startsWith('mailto:') ? `${text} <${href}>` : text;
  });
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

export function looksLikeHtml(s: string): boolean {
  return /^\s*(<!doctype html|<html|<body|<table|<div)/i.test(s) || (/<\/(p|div|td|tr|table|span)>/i.test(s) && /<[a-z][^>]*>/i.test(s));
}

/** Parses "Name <email>" or bare email into a PersonRef-ish pair. */
export function parseAddress(raw: string): { name?: string; email?: string } {
  const s = raw.trim().replace(/^"|"$/g, '');
  const m = s.match(/^(.*?)\s*<([^<>@\s]+@[^<>\s]+)>$/);
  if (m) {
    const name = (m[1] ?? '').trim().replace(/^"|"$/g, '');
    return { name: name || undefined, email: m[2]!.toLowerCase() };
  }
  const bare = s.match(/^<?([^<>@\s]+@[^<>\s]+)>?$/);
  if (bare) return { email: bare[1]!.toLowerCase() };
  return { name: s || undefined };
}

/** Splits an RFC 5322 address list on commas that are outside quotes and angle brackets. */
export function splitAddressList(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  let inAngle = false;
  for (const ch of raw) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === '<' && !inQuote) inAngle = true;
    else if (ch === '>' && !inQuote) inAngle = false;
    if (ch === ',' && !inQuote && !inAngle) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const DRIVE_URL_RE = /https?:\/\/(?:docs|drive|sheets|slides)\.google\.com\/(?:(?:document|presentation|spreadsheets|forms)\/d\/|file\/d\/|drive\/folders\/|open\?id=)([A-Za-z0-9_-]{15,})/g;

/** Extracts Drive file ids from free text, in order of first appearance. */
export function extractDriveIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(DRIVE_URL_RE)) if (!ids.includes(m[1]!)) ids.push(m[1]!);
  return ids;
}

export function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) urls.add(m[0].replace(/[.,;:]+$/, ''));
  return [...urls];
}
