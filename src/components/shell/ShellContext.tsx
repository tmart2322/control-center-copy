'use client';
/**
 * Shell state shared by the chrome and pages: frame width tier, the sidebar (`[`), overlays
 * (palette, cheat sheet, utility popovers) and the topbar strip. The docked right panel has its own
 * API (useRightPanel in panel.tsx).
 *
 * v1 fields stay so pages keep compiling while the page lanes move to v2:
 *   - railPanels / registerRailPanel / railTab / setRailTab / setRailCollapsed: inert (no right rail).
 *   - railCollapsed mirrors "panel closed"; toggleRail toggles the panel (`]`).
 *   - dayCollapsed / toggleDay still hold state, but `[` now collapses the sidebar.
 *   - focusChat opens the panel on Assistant and focuses the composer (⌘J's open half).
 *   - navStrip is the topbar slot to the right of the page title (<NavStrip>).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { focusChat as focusChatComposer } from '@/components/chat';
import { frameTier, SIDEBAR_AUTO_COLLAPSE, type FrameTier } from './nav';
import { usePanelInternals, useRightPanel } from './panel';

export interface RailPanelDef {
  id: string;
  label: string;
  icon: string;
  order?: number;
  count?: number;
}

export type UtilityId = 'capture' | 'since' | 'catchup' | 'dryrun' | 'spend' | null;

export const CHAT_TAB = 'assistant';

interface ShellState {
  width: number;
  tier: FrameTier;
  /** Frame ≥ 1920 px. */
  wide: boolean;
  /** Sidebar is the 64 px icon rail (`[`; automatic below a 1,440 px frame). */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  /** @deprecated no right rail in v2: always empty. */
  railPanels: RailPanelDef[];
  /** @deprecated no-op. */
  registerRailPanel: (def: RailPanelDef) => () => void;
  /** @deprecated always the assistant. */
  railTab: string;
  /** @deprecated no-op. */
  setRailTab: (id: string) => void;
  /** @deprecated mirrors "right panel closed". */
  railCollapsed: boolean;
  /** @deprecated no-op. */
  setRailCollapsed: (v: boolean) => void;
  /** Toggle the right panel (`]`). */
  toggleRail: () => void;
  dayCollapsed: boolean;
  setDayCollapsed: (v: boolean) => void;
  toggleDay: () => void;
  /** Open the panel on Assistant and focus the composer (on /assistant: focus the page composer). */
  focusChat: () => void;
  /** Register the chat composer's focus function (focusChat calls it). */
  registerChatFocus: (fn: () => void) => () => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  cheatOpen: boolean;
  setCheatOpen: (v: boolean) => void;
  utility: UtilityId;
  setUtility: (id: UtilityId) => void;
  navStrip: HTMLElement | null;
  setNavStrip: (el: HTMLElement | null) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell() must be used inside <AppFrame>');
  return ctx;
}

/** Like useShell but returns null outside the frame (kit renders, tests). */
export function useShellOptional(): ShellState | null {
  return useContext(ShellContext);
}

const SIDEBAR_KEY = 'cc:sidebar-collapsed';
const DAY_KEY = 'cc:day-collapsed';

function readJson(key: string): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: Record<string, boolean>) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const NO_RAIL_PANELS: RailPanelDef[] = [];
const noop = () => {};
const noopUnregister = () => noop;

export function ShellProvider({ children, width }: { children: ReactNode; width: number }) {
  const tier = frameTier(width);
  const wide = width >= 1920;
  const panel = useRightPanel();
  const { togglePanel, visible, assistantHere } = usePanelInternals();
  const [sidebarPref, setSidebarPref] = useState<Record<string, boolean>>({});
  const [dayCollapsed, setDayCollapsedState] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [utility, setUtility] = useState<UtilityId>(null);
  const [navStrip, setNavStrip] = useState<HTMLElement | null>(null);
  const chatFocus = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSidebarPref(readJson(SIDEBAR_KEY));
    setDayCollapsedState(readJson(DAY_KEY).today ?? false);
  }, []);

  // Collapse memory per width bucket: below 1,440 px the rail is the default, above it the full sidebar.
  const bucket = width < SIDEBAR_AUTO_COLLAPSE ? 'narrow' : 'wide';
  const sidebarCollapsed = sidebarPref[bucket] ?? bucket === 'narrow';
  const setSidebarCollapsed = useCallback(
    (v: boolean) =>
      setSidebarPref((prev) => {
        const next = { ...prev, [bucket]: v };
        writeJson(SIDEBAR_KEY, next);
        return next;
      }),
    [bucket],
  );
  const toggleSidebar = useCallback(() => setSidebarCollapsed(!sidebarCollapsed), [sidebarCollapsed, setSidebarCollapsed]);

  const setDayCollapsed = useCallback((v: boolean) => {
    setDayCollapsedState(v);
    writeJson(DAY_KEY, { today: v });
  }, []);
  const toggleDay = useCallback(() => setDayCollapsed(!dayCollapsed), [dayCollapsed, setDayCollapsed]);

  const { openAssistant } = panel;
  const focusChat = useCallback(() => {
    // On /assistant the page's own composer is the assistant; elsewhere open the panel's tab first.
    if (assistantHere) return focusChatComposer();
    openAssistant();
    // The assistant pane mounts on first open: wait two frames for its composer.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (chatFocus.current) chatFocus.current();
        else focusChatComposer();
      }),
    );
  }, [openAssistant, assistantHere]);

  const registerChatFocus = useCallback((fn: () => void) => {
    chatFocus.current = fn;
    return () => {
      if (chatFocus.current === fn) chatFocus.current = null;
    };
  }, []);

  const railCollapsed = !visible;

  const value = useMemo<ShellState>(
    () => ({
      width,
      tier,
      wide,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
      railPanels: NO_RAIL_PANELS,
      registerRailPanel: noopUnregister,
      railTab: CHAT_TAB,
      setRailTab: noop,
      railCollapsed,
      setRailCollapsed: noop,
      toggleRail: togglePanel,
      dayCollapsed,
      setDayCollapsed,
      toggleDay,
      focusChat,
      registerChatFocus,
      paletteOpen,
      setPaletteOpen,
      cheatOpen,
      setCheatOpen,
      utility,
      setUtility,
      navStrip,
      setNavStrip,
    }),
    [width, tier, wide, sidebarCollapsed, setSidebarCollapsed, toggleSidebar, railCollapsed, togglePanel, dayCollapsed, setDayCollapsed, toggleDay, focusChat, registerChatFocus, paletteOpen, cheatOpen, utility, navStrip],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
