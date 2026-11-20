'use client';
/**
 * VDP ▸ My VDPs (?view=vdp&sub=mine, D-60): each current VDP at a glance, as VDP records it.
 *
 *   head       company · period, and its state: "N missing" (something VDP lacks) and "N to check" (a value that looks
 *              wrong), each a jump to those changes on the Changes tab; or Done
 *   who        on the VDP: AE, TA, collaborators and stakeholders
 *   use cases  each title, with "inputs complete" or what is missing, and whether its AI fields are generated
 *   assets     how many, and each title (its Deliverable type when VDP has one)
 *
 * The row opens the VDP's details in the docked panel; "Ask about this VDP" opens the Assistant on it ("I think
 * something is missing, can you look?"); "Open in VDP ↗" once per VDP. Past VDPs are folded at the end.
 */
import { useState } from 'react';
import type { VdpCoveragePayload } from '@/contract';
import { Pane, useDetails } from '@/components/deals/context-frame';
import { StatusBadge } from '@/components/domain';
import { navigate } from '@/components/shell/router';
import { useRightPanel } from '@/components/shell/panel';
import { Button, cn, Icon } from '@/ui';
import { mineRows, personText, type MineRow } from './vdp-changes-derive';
import { OpenInVdp, VdpStatusChip } from './VdpItem';

export function VdpMine({ cov }: { cov: VdpCoveragePayload }) {
  const { current, past } = mineRows(cov);
  const [showPast, setShowPast] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="vdp-mine">
      {current.length ? current.map((m) => <MineCard key={m.row.vdpSlug} m={m} />) : <p className="rounded-md border border-line bg-surface px-5 py-4 text-body">No current VDPs: the ones for this or a later quarter, or with an open opportunity, show here.</p>}
      {past.length ? (
        <section className="min-w-0 rounded-md border border-line bg-surface" data-testid="vdp-mine-past">
          <button type="button" className="flex w-full min-w-0 items-center gap-2 px-5 py-3 text-left" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}>
            <Icon name={showPast ? 'chevrondown' : 'chevronright'} size="sm" className="text-muted" />
            <span className="font-bold text-fg-heading">{`${past.length} past`}</span>
            <span className="min-w-0 text-caption text-muted">old fiscal periods on closed opportunities: not checked</span>
          </button>
          {showPast ? (
            <div className="flex flex-col gap-3 border-t border-line p-3">
              {past.map((m) => (
                <MineCard key={m.row.vdpSlug} m={m} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function People({ label, list }: { label: string; list: Array<{ name: string | null; email?: string | null; title?: string | null }> }) {
  return (
    <p className="min-w-0 text-body">
      <span className="text-caption font-bold text-muted">{label}</span> <span className={cn(list.length ? 'text-fg' : 'text-muted')}>{list.length ? list.map(personText).join(', ') : 'none'}</span>
    </p>
  );
}

function MineCard({ m }: { m: MineRow }) {
  const details = useDetails();
  const panel = useRightPanel();
  const v = m.row;
  const s = v.summary;
  const label = `${v.companyName}${m.fiscal ? ` · ${m.fiscal}` : ''}`;
  const open = () => details.open({ kind: 'vdp', id: v.vdpSlug, label: v.companyName });
  const toChanges = () => navigate(`/activity?view=vdp&focus=${encodeURIComponent(v.vdpSlug)}`);
  return (
    <Pane
      aria-label={`VDP ${label}`}
      data-vdp={v.vdpSlug}
      data-status={m.state}
      scroll={false}
      head={
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-3 pb-2">
          <h2 className="min-w-0 text-lead font-bold text-fg-heading">
            <button type="button" className={cn('text-left hover:underline', details.openId === v.vdpSlug && 'underline')} onClick={open} data-testid="vdp-mine-open">
              {v.companyName}
              {m.fiscal ? <span className="font-normal text-muted"> · {m.fiscal}</span> : null}
            </button>
          </h2>
          {m.state === 'open' ? (
            <span className="flex flex-wrap items-center gap-2">
              {m.missing ? (
                <button type="button" onClick={toChanges} className="rounded-full" data-testid="vdp-mine-missing" title="Open these on the Changes tab">
                  <StatusBadge tone="now" icon="record_update">{`${m.missing} missing`}</StatusBadge>
                </button>
              ) : null}
              {m.toCheck ? (
                <button type="button" onClick={toChanges} className="rounded-full" data-testid="vdp-mine-check" title="Open these on the Changes tab">
                  <StatusBadge tone="warning" icon="warning">{`${m.toCheck} to check`}</StatusBadge>
                </button>
              ) : null}
            </span>
          ) : (
            <VdpStatusChip status={v.status} />
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="quiet" icon="chat" onClick={() => panel.openAssistant({ kind: 'vdp', id: v.vdpSlug, label: v.companyName })} data-testid="vdp-mine-ask">
              Ask about this VDP
            </Button>
            {v.url ? <OpenInVdp url={v.url} /> : null}
          </span>
        </div>
      }
    >
      {s ? (
        <div className="grid min-w-0 gap-4 border-t border-line px-5 py-3 md:grid-cols-3" data-testid="vdp-mine-summary">
          <div className="min-w-0 space-y-1">
            <h3 className="text-caption font-bold text-fg-heading uppercase">On the VDP</h3>
            <People label="AE" list={s.people.aes} />
            <People label="TA" list={s.people.tas} />
            {s.people.collaborators.length ? <People label="Collaborators" list={s.people.collaborators} /> : null}
            {s.people.stakeholders.length ? <People label="Stakeholders" list={s.people.stakeholders.map((x) => ({ name: x.name, title: x.title }))} /> : null}
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-caption font-bold text-fg-heading uppercase">{`Use cases · ${s.useCases.length}`}</h3>
            {s.useCases.length ? (
              <ul className="space-y-1">
                {s.useCases.map((u) => (
                  <li key={u.id} className="min-w-0 text-body">
                    <span className="text-fg">{u.title}</span>
                    <span className="block text-caption text-muted">
                      {u.inputsComplete ? 'inputs complete' : u.missing.length ? `missing ${u.missing.join(', ')}` : 'details not read yet'} · {u.hasAi ? 'AI generated' : 'AI not generated'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted">none yet</p>
            )}
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-caption font-bold text-fg-heading uppercase">{`Assets · ${s.assets.length}`}</h3>
            {s.assets.length ? (
              <ul className="space-y-1">
                {s.assets.map((a) => (
                  <li key={a.url} className="min-w-0 text-body">
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                      {a.title ?? a.url}
                    </a>
                    {a.deliverableType || a.type ? <span className="text-caption text-muted"> · {[a.deliverableType, a.type].filter(Boolean).join(' · ')}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted">none linked</p>
            )}
          </div>
        </div>
      ) : null}
    </Pane>
  );
}

