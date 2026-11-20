'use client';
/**
 * Display prefs: colour scheme (dark first), density and text size. Instant (UI-SPEC §8 "Simple
 * prefs"): the <html> attributes flip immediately, localStorage keeps them for a flash-free boot
 * (PREFS_BOOT_SCRIPT), and all three sync to settings.display (scheme, density, textSize in px).
 *
 *   data-theme   'dark' | 'light'; `system` resolves through prefers-color-scheme and follows OS changes
 *   data-text    'sm' | 'md' | 'lg' (DISPLAY_TEXT_ATTR: 15 / 16 / 18 px on the server)
 *
 * Server writes go one at a time and coalesce (latest value wins), each on the version the previous
 * one returned; a 409 rebases on `current.display.version` (the 409 carries the whole Settings).
 *
 * The v1 Lightning/Cosmos brand ramp is gone: `brand` stays on the API as an inert, deprecated field
 * so older callers compile, and old stored values are read without crashing (then dropped).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DISPLAY_TEXT_ATTR, type DisplayTextSize } from '@/contract';
import { useApi } from '@/client/hooks';
import { useOptimisticMutation } from '@/client/optimistic/useOptimisticMutation';
import { toast } from '@/client/toast/store';
import { PREFS_DEFAULTS, PREFS_KEY, PREFS_VERSION } from './prefs-boot';

export type Density = 'compact' | 'comfortable';
export type ColorScheme = 'dark' | 'light' | 'system';
export type TextSize = 'sm' | 'md' | 'lg';
/** @deprecated v2 has one Salesforce Blue ramp. Reading it is fine; setting it does nothing. */
export type BrandRamp = 'lightning' | 'cosmos';

export interface Prefs {
  scheme: ColorScheme;
  density: Density;
  textSize: TextSize;
}

export const DEFAULT_PREFS: Prefs = { ...PREFS_DEFAULTS };

const SCHEMES: readonly ColorScheme[] = ['dark', 'light', 'system'];
const DENSITIES: readonly Density[] = ['compact', 'comfortable'];
const TEXT_SIZES: readonly TextSize[] = ['sm', 'md', 'lg'];

/** 'system' → the OS scheme right now. */
export function resolveScheme(scheme: ColorScheme): 'dark' | 'light' {
  if (scheme !== 'system') return scheme;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Server px ↔ the <html data-text> form. */
export const TEXT_PX: Record<TextSize, DisplayTextSize> = { sm: 15, md: 16, lg: 18 };
export function textSizeFrom(v: unknown): TextSize | null {
  if (v === 'sm' || v === 'md' || v === 'lg') return v;
  return v === 15 || v === 16 || v === 18 ? DISPLAY_TEXT_ATTR[v] : null;
}

export function applyPrefs(p: Prefs) {
  const h = document.documentElement;
  h.setAttribute('data-theme', resolveScheme(p.scheme));
  h.setAttribute('data-density', p.density);
  h.setAttribute('data-text', p.textSize);
}

/**
 * Parse whatever is stored (v2, v1 or junk) into v2 prefs. Mirrors PREFS_BOOT_SCRIPT: v1's light and
 * compact were its defaults, so they give way to the v2 defaults. Returns null when nothing is stored.
 */
export function parseStoredPrefs(raw: string | null): Prefs | null {
  if (!raw) return null;
  let p: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    p = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const v2 = p.v === PREFS_VERSION;
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T, v1Default?: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) && (v2 || value !== v1Default) ? (value as T) : fallback;
  return {
    scheme: pick(p.scheme, SCHEMES, DEFAULT_PREFS.scheme, 'light'),
    density: pick(p.density, DENSITIES, DEFAULT_PREFS.density, 'compact'),
    textSize: pick(p.textSize, TEXT_SIZES, DEFAULT_PREFS.textSize),
  };
}

function readStored(): Prefs | null {
  try {
    return parseStoredPrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return null;
  }
}

function writeStored(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ v: PREFS_VERSION, ...p }));
  } catch {
    /* ignore */
  }
}

export type PrefsPatch = Partial<Omit<Prefs, 'textSize'>> & {
  /** 'sm' | 'md' | 'lg', or the server's px (15 | 16 | 18). */
  textSize?: TextSize | DisplayTextSize;
  /** @deprecated ignored (the brand ramp pref was removed in v2). */
  brand?: BrandRamp;
};

type DisplayValue = { scheme?: ColorScheme; density?: Density; textSize?: DisplayTextSize };

interface PrefsApi extends Prefs {
  /** @deprecated always 'lightning'; v2 has one ramp. */
  brand: BrandRamp;
  set: (patch: PrefsPatch) => void;
}

const PrefsContext = createContext<PrefsApi>({ ...DEFAULT_PREFS, brand: 'lightning', set: () => {} });

export function usePrefs(): PrefsApi {
  return useContext(PrefsContext);
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const hadStored = useRef(false);
  const settings = useApi('getSettings');
  // The display section's latest known version: quick successive changes must not race the refetch (409).
  const version = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const wanted = useRef<DisplayValue | null>(null);
  const serverVersion = settings.data?.display.version;
  useEffect(() => {
    if (serverVersion !== undefined && (version.current === undefined || serverVersion > version.current)) version.current = serverVersion;
  }, [serverVersion]);
  const patch = useOptimisticMutation({
    route: 'patchSettings',
    topics: ['settings'],
    writeBack: false,
    onSuccess: (res) => {
      version.current = res.entity.display.version;
    },
    // Display prefs are last-write-wins: re-send on the server's version (the 409 carries the whole Settings).
    rebase: ({ input, current }) => {
      const v = (current as { display?: { version?: unknown } }).display?.version;
      if (typeof v !== 'number') return null;
      version.current = v;
      return { ...input, body: { ...input.body!, ifVersion: v } };
    },
    onError: () =>
      toast({
        key: 'prefs-save',
        tone: 'warning',
        title: "Couldn't save display settings",
        body: 'They apply on this machine; the server copy is unchanged.',
        action: { label: 'Retry', onClick: () => patch.retry() },
      }),
  });

  // Adopt what the boot script applied, rewriting v1 storage as v2. `?theme=` wins for this load only.
  useEffect(() => {
    const stored = readStored();
    hadStored.current = Boolean(stored);
    const next = { ...(stored ?? DEFAULT_PREFS) };
    const q = new URLSearchParams(window.location.search).get('theme');
    if (q && (SCHEMES as readonly string[]).includes(q)) next.scheme = q as ColorScheme;
    setPrefs(next);
    applyPrefs(next);
    if (stored) writeStored(stored);
  }, []);

  // First run on this machine: adopt what the user saved on the server (version > 1 = changed at least once).
  const display = settings.data?.display;
  useEffect(() => {
    if (!display || hadStored.current || display.version <= 1) return;
    setPrefs((prev) => {
      const next: Prefs = {
        scheme: (SCHEMES as readonly string[]).includes(display.scheme) ? display.scheme : prev.scheme,
        density: display.density,
        textSize: textSizeFrom(display.textSize) ?? prev.textSize,
      };
      applyPrefs(next);
      return next;
    });
    // only on first settings load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display?.version]);

  // `system` follows the OS while it's chosen.
  useEffect(() => {
    if (prefs.scheme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => document.documentElement.setAttribute('data-theme', resolveScheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [prefs.scheme]);

  const set = useCallback(
    (p: PrefsPatch) => {
      const rest: Partial<Prefs> = {};
      if (p.scheme && (SCHEMES as readonly string[]).includes(p.scheme)) rest.scheme = p.scheme;
      if (p.density && (DENSITIES as readonly string[]).includes(p.density)) rest.density = p.density;
      const ts = p.textSize === undefined ? null : textSizeFrom(p.textSize);
      if (ts) rest.textSize = ts;
      if (!Object.keys(rest).length) return;
      setPrefs((prev) => {
        const next = { ...prev, ...rest };
        applyPrefs(next);
        writeStored(next);
        hadStored.current = true;
        return next;
      });
      // One write at a time, latest values win: rapid toggles coalesce instead of racing into a 409.
      const value: DisplayValue = { ...rest, textSize: rest.textSize ? TEXT_PX[rest.textSize] : undefined };
      if (!value.textSize) delete value.textSize;
      wanted.current = { ...wanted.current, ...value };
      queue.current = queue.current.then(async () => {
        const next = wanted.current;
        const v = version.current;
        if (!next || v === undefined) return;
        wanted.current = null;
        await patch.mutateAsync({ params: { section: 'display' }, body: { ifVersion: v, value: next } }).catch(() => undefined);
      });
    },
    [patch],
  );

  return <PrefsContext.Provider value={{ ...prefs, brand: 'lightning', set }}>{children}</PrefsContext.Provider>;
}
