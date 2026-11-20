/**
 * Resource cards: links into items, accounts, drafts, sessions and files (VDP's ResourceCard, SLDS tiles).
 * In-app links stay in the app; external ones (Drive, Slack) open a new tab. Opening is a read, never a write.
 * v2 renders most resources as quiet evidence chips (EvidenceChips); drafts and sessions get their own cards.
 */
import { AppLink } from '@/components/shell/AppLink';
import type { ChatResource } from '@/contract';
import { Icon } from '@/ui';
import { ChatIcon } from './icons';
import v2 from './assistant.module.css';

type Tile = { set: 'standard' | 'utility' | 'doctype'; name: string; bg?: string; word: string };

function tileFor(r: ChatResource): Tile {
  switch (r.kind) {
    case 'work_item':
      return { set: 'standard', name: 'task', bg: 'bg-std-task', word: 'Task' };
    case 'account':
      return { set: 'standard', name: 'account', bg: 'bg-std-account', word: 'Account' };
    case 'opportunity':
      return { set: 'standard', name: 'opportunity', bg: 'bg-std-opportunity', word: 'Opportunity' };
    case 'calendar_event':
      return { set: 'standard', name: 'event', bg: 'bg-std-event', word: 'Meeting' };
    case 'person':
      return { set: 'standard', name: 'user', bg: 'bg-std-user', word: 'Person' };
    case 'initiative':
      return { set: 'standard', name: 'campaign', bg: 'bg-std-report', word: 'Initiative' };
    case 'brief':
      return { set: 'utility', name: 'summary', word: 'Brief' };
    case 'policy':
      return { set: 'utility', name: 'priority', word: 'Policy' };
    case 'agent_run':
      return { set: 'utility', name: 'agent_session', word: 'Claude session' };
    case 'draft':
      return { set: 'utility', name: 'email', word: 'Outbox draft' };
    case 'asset':
    case 'file': {
      const l = r.label.toLowerCase();
      const name = /deck|slides|presentation/.test(l) ? 'gpres' : /sheet|estimate|calculator|forecast/.test(l) ? 'gsheet' : /\.pdf|pdf\b|architecture/.test(l) ? 'pdf' : 'gdoc';
      return { set: 'doctype', name, word: name === 'gpres' ? 'Slides' : name === 'gsheet' ? 'Sheet' : name === 'pdf' ? 'PDF' : 'Doc' };
    }
    default:
      return { set: 'utility', name: 'link', word: 'Link' };
  }
}

const isExternal = (href: string) => /^https?:\/\//i.test(href);

export function ChatResourceCard({ resource }: { resource: ChatResource }) {
  const t = tileFor(resource);
  const ext = isExternal(resource.href);
  const host = ext ? (() => { try { return new URL(resource.href).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
  const body = (
    <>
      {t.bg ? (
        <span className={`grid size-6 shrink-0 place-items-center rounded-md text-white ${t.bg}`}>
          <Icon set={t.set} name={t.name} size="md" />
        </span>
      ) : t.set === 'doctype' ? (
        <Icon set="doctype" name={t.name} size="xl" />
      ) : (
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
          <Icon set={t.set} name={t.name} size="sm" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-bold text-fg group-hover:text-brand-800">{resource.label}</span>
        <span className="block truncate text-caption text-muted">
          {t.word}
          {host ? ` · ${host}` : ''}
        </span>
      </span>
      <Icon name={ext ? 'new_window' : 'chevronright'} size="xs" className="shrink-0 text-faint group-hover:text-brand-600" />
    </>
  );
  const cls = 'group flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 shadow-card transition-colors duration-(--dur-quick) hover:border-brand-300 hover:bg-brand-50 hover:no-underline';
  return ext ? (
    <a href={resource.href} target="_blank" rel="noopener noreferrer" className={cls} data-resource={resource.kind}>
      {body}
    </a>
  ) : (
    <AppLink href={resource.href} className={cls} data-resource={resource.kind}>
      {body}
    </AppLink>
  );
}

export function ResourceList({ resources }: { resources: ChatResource[] }) {
  if (!resources.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {resources.map((r) => (
        <ChatResourceCard key={`${r.kind}:${r.id}`} resource={r} />
      ))}
    </div>
  );
}

// ── v2: evidence chips ("Calendar · 13:30 review ↗") ────────────────────────────────────────────

const CHIP_WORD: Partial<Record<string, string>> = {
  work_item: 'Item',
  account: 'Account',
  opportunity: 'Opp',
  calendar_event: 'Calendar',
  person: 'Person',
  initiative: 'Initiative',
  brief: 'Brief',
  policy: 'Policy',
  url: 'Link',
};

/** True once V2-SHELL renders the docked panel (it marks #cc-main with data-panel). */
export function rightPanelLive(): boolean {
  return typeof document !== 'undefined' && !!document.getElementById('cc-main')?.hasAttribute('data-panel');
}

export function EvidenceChips({ resources, onOpenItem }: { resources: ChatResource[]; onOpenItem?: (r: ChatResource) => void }) {
  if (!resources.length) return null;
  return (
    <div className={v2.evs} data-evidence>
      {resources.map((r) => {
        const ext = isExternal(r.href);
        const word = r.kind === 'asset' || r.kind === 'file' ? tileFor(r).word : (CHIP_WORD[r.kind] ?? 'Link');
        const body = (
          <>
            <span className={v2.k}>{word}</span>
            <span className={v2.lbl}>{r.label}</span>
            <ChatIcon name={ext ? 'ext' : 'chev-r'} size={14} />
          </>
        );
        const key = `${r.kind}:${r.id}`;
        return ext ? (
          <a key={key} href={r.href} target="_blank" rel="noopener noreferrer" className={v2.ev} data-resource={r.kind} title={r.label}>
            {body}
          </a>
        ) : (
          <AppLink
            key={key}
            href={r.href}
            className={v2.ev}
            data-resource={r.kind}
            title={r.label}
            onClick={(e) => {
              if (r.kind === 'work_item' && onOpenItem && rightPanelLive()) {
                e.preventDefault();
                onOpenItem(r);
              }
            }}
          >
            {body}
          </AppLink>
        );
      })}
    </div>
  );
}
