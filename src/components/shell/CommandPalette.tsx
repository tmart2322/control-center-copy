'use client';
/**
 * ⌘K command palette (UI-SPEC §5.3, brief 08 §2.11/§3.7 #7): search and commands share one box.
 * Order: the focused item's actions first (with their keys), then search hits (GET /search),
 * then Go to / Create / View and every command other lanes registered with useCommands().
 * Each row shows its shortcut so the palette teaches the keymap.
 */
import { Command as Cmdk } from 'cmdk';
import { useEffect, useMemo, useState } from 'react';
import type { EntityType, SearchHit } from '@/contract';
import { useApi } from '@/client/hooks';
import { useCommandSnapshot, type Command } from '@/client/keyboard/commands';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';
import { Kbd, KbdHint } from '@/ui/Kbd';
import { Overlay } from '@/ui/Overlay';
import { Spinner } from '@/ui/Spinner';
import { StatePill } from '@/ui/badges';
import { navigate } from './router';

const ENTITY_ICON: Partial<Record<EntityType, string>> = {
  work_item: 'task',
  initiative: 'strategy',
  account: 'company',
  opportunity: 'opportunity',
  person: 'user',
  asset: 'file',
  agent_run: 'agent_session',
  chat_thread: 'chat',
  brief: 'summary',
  calendar_event: 'event',
  tool_adapter: 'apps',
};

/**
 * Where a search hit (or a panel entity without a renderer) opens when the server sent no href. Each kind lands on
 * the thing itself: a draft opens in the Outbox panel, an opp on its account page (Deals resolves `?opp=`), a
 * missed opp in Missed. `/` only for kinds with no page.
 */
export function hrefForRef(ref: { type: EntityType; id: string; href?: string }): string {
  if (ref.href) return ref.href;
  const id = encodeURIComponent(ref.id);
  switch (ref.type) {
    case 'work_item':
      return `/work/${id}`;
    case 'initiative':
      return `/initiatives/${id}`;
    case 'account':
      return `/deals/${id}`;
    case 'opportunity':
      return `/deals?opp=${id}`;
    case 'missed_opp':
      return `/deals/missed?id=${id}`;
    case 'brief':
      return `/briefs?brief=${id}`;
    case 'agent_run':
      return `/agents?run=${id}`;
    case 'draft':
      return `/outbox?draft=${id}`;
    case 'connector':
      return '/settings?section=connectors';
    default:
      return '/';
  }
}

const GROUP_ORDER = ['Go to', 'Create', 'View', 'Help'];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CommandRow({ c, onRun, focused }: { c: Command; onRun: (c: Command) => void; focused?: boolean }) {
  return (
    <Cmdk.Item
      value={`${focused ? 'focus' : 'cmd'}:${c.id}`}
      keywords={[c.title, ...(c.keywords ?? []), c.subtitle ?? '', c.group ?? '']}
      disabled={c.disabled}
      onSelect={() => onRun(c)}
      className="flex h-9 cursor-default items-center gap-3 rounded-md px-2.5 text-body text-fg data-[disabled=true]:text-faint data-[selected=true]:bg-brand-50 data-[selected=true]:text-brand-900 comfortable:h-10"
    >
      <Icon set={c.icon?.set ?? 'utility'} name={c.icon?.name ?? 'chevronright'} size="sm" className="text-muted" />
      <span className="min-w-0 flex-1 truncate">
        {c.title}
        {c.subtitle ? <span className="ml-2 text-caption text-muted">{c.subtitle}</span> : null}
      </span>
      {c.shortcut ? <KbdHint combo={c.shortcut} /> : null}
    </Cmdk.Item>
  );
}

function HitRow({ h, onOpen }: { h: SearchHit; onOpen: (h: SearchHit) => void }) {
  return (
    <Cmdk.Item
      value={`hit:${h.ref.type}:${h.ref.id}`}
      onSelect={() => onOpen(h)}
      className="flex h-11 cursor-default items-center gap-3 rounded-md px-2.5 text-body text-fg data-[selected=true]:bg-brand-50 data-[selected=true]:text-brand-900"
    >
      <Icon name={ENTITY_ICON[h.ref.type] ?? 'record'} size="sm" className="text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{h.title}</span>
        {h.subtitle ? <span className="block truncate text-caption text-muted">{h.subtitle}</span> : null}
      </span>
      {h.state && h.state !== 'open' ? <StatePill size="xs" tone={h.state === 'done' ? 'ok' : h.state === 'waiting_on_me' || h.state === 'reopened' ? 'warn' : h.state === 'suggested' || h.state === 'likely_done' ? 'ai' : 'neutral'} label={h.state.replace(/_/g, ' ')} /> : null}
      <span className="text-caption text-faint capitalize">{h.ref.type.replace(/_/g, ' ')}</span>
    </Cmdk.Item>
  );
}

const heading = '[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { commands, focused } = useCommandSnapshot();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 120);
  const search = useApi('search', { query: { q: debounced, limit: 8 } }, { enabled: open && debounced.length >= 2, placeholderData: (prev) => prev });

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const groups = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of commands) {
      const g = c.group ?? 'Commands';
      map.set(g, [...(map.get(g) ?? []), c]);
    }
    for (const list of map.values()) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return [...map.entries()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a[0]);
      const ib = GROUP_ORDER.indexOf(b[0]);
      return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a[0].localeCompare(b[0]);
    });
  }, [commands]);

  const run = (c: Command) => {
    onClose();
    // Let the overlay restore focus first, then run (so commands that focus things win).
    requestAnimationFrame(() => void c.run());
  };
  const openHit = (h: SearchHit) => {
    onClose();
    navigate(hrefForRef(h.ref));
  };

  const hits = debounced.length >= 2 ? (search.data?.hits ?? []) : [];

  return (
    <Overlay open={open} onClose={onClose} position="top" className="w-[min(40rem,92vw)]" labelledBy="cc-palette-label">
      <Cmdk
        label="Command palette"
        loop
        filter={(value, search, keywords) => {
          // Server hits are already ranked; keep them, below matching commands.
          if (value.startsWith('hit:')) return 0.5;
          const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
          if (!tokens.length) return 1;
          const words = (keywords ?? []).join(' ').toLowerCase();
          // Every token must appear; word-start matches rank higher. Focused-item actions lead.
          let score = value.startsWith('focus:') ? 1 : 0.9;
          for (const t of tokens) {
            const at = words.indexOf(t);
            if (at < 0) return 0;
            if (at !== 0 && words[at - 1] !== ' ') score -= 0.15;
          }
          return Math.max(0.55, score);
        }}
        className="flex max-h-[min(34rem,70vh)] flex-col"
      >
        <span id="cc-palette-label" className="sr-only">
          Search or run a command
        </span>
        <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
          <Icon name="search" size="md" className="text-muted" />
          <Cmdk.Input
            data-autofocus
            value={q}
            onValueChange={setQ}
            placeholder={focused ? `Actions for "${focused.context.label}", search, or a command` : 'Search items, accounts, people… or type a command'}
            className="min-w-0 flex-1 bg-transparent text-body-lg text-fg outline-none placeholder:text-faint"
          />
          {search.isFetching ? <Spinner size="sm" className="text-muted" /> : null}
          <Kbd>Esc</Kbd>
        </div>
        <Cmdk.List className={cn('cc-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-2', heading)}>
          <Cmdk.Empty className="px-3 py-6 text-center text-body text-muted">{debounced.length >= 2 && search.isFetching ? 'Searching…' : `Nothing matches "${q}". Try a name, account or verb.`}</Cmdk.Empty>
          {focused && focused.commands.length ? (
            <Cmdk.Group heading={`This item · ${focused.context.label}`}>
              {focused.commands.map((c) => (
                <CommandRow key={c.id} c={c} onRun={run} focused />
              ))}
            </Cmdk.Group>
          ) : null}
          {groups.map(([g, list]) => (
            <Cmdk.Group key={g} heading={g}>
              {list.map((c) => (
                <CommandRow key={c.id} c={c} onRun={run} />
              ))}
            </Cmdk.Group>
          ))}
          {hits.length ? (
            <Cmdk.Group heading={`Search · ${search.data?.total ?? hits.length} found`}>
              {hits.map((h) => (
                <HitRow key={`${h.ref.type}:${h.ref.id}`} h={h} onOpen={openHit} />
              ))}
            </Cmdk.Group>
          ) : null}
        </Cmdk.List>
        <div className="flex h-8 shrink-0 items-center gap-4 border-t border-line bg-surface-muted px-4 text-caption text-muted">
          <span className="inline-flex items-center gap-1">
            <KbdHint combo="up" />
            <KbdHint combo="down" /> move
          </span>
          <span className="inline-flex items-center gap-1">
            <KbdHint combo="enter" /> run
          </span>
          <span className="ml-auto">Every action has a key; the palette shows it.</span>
        </div>
      </Cmdk>
    </Overlay>
  );
}
