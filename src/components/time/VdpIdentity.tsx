'use client';
/**
 * A company node's identity on Time ▸ VDP ▸ Changes (D-69): which VDP company this is, how the app decided it, and
 * Change… to pick another (search VDP's companies, read-only), create one with a name you type, and choose which
 * Org62 accounts belong to it. Save stores your mapping (user-locked: every read keeps it; the toast's Undo and the
 * node's Reset drop it). Nothing is sent to VDP here: the items under the node are pushed as usual.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { VdpCompanyIdentity } from '@/contract';
import { api, type ApiError } from '@/client/api';
import { useApi } from '@/client/hooks';
import { toast } from '@/client/toast';
import { StatusBadge } from '@/components/domain';
import { Button, cn, Dialog } from '@/ui';
import { changeOptions, changeProblem, changeRequest, identityBadge, identityLine, initialChange, type ChangeState } from './vdp-identity-derive';
import { errorText } from '@/lib/error-text';

export function IdentityLine({ identity }: { identity: VdpCompanyIdentity }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const b = identityBadge(identity);
  const reset = useMutation({
    mutationFn: () => api('clearVdpIdentity', { body: { key: identity.key } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['deals'] });
      toast({ key: `vdp-identity-${identity.key}`, tone: 'success', title: 'Back to the app’s own decision', ...(r.auditId ? { undo: { auditId: r.auditId } } : {}) });
    },
    onError: (e: ApiError) => toast({ key: `vdp-identity-${identity.key}`, tone: 'error', title: "Couldn't reset it", body: errorText(e, 200) }),
  });
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="vdp-identity" data-identity-state={identity.state} data-identity-by={identity.by}>
      <StatusBadge tone={b.tone} icon={b.icon}>
        {b.text}
      </StatusBadge>
      <span className="min-w-0 text-caption text-muted">{identityLine(identity)}</span>
      <span className="min-w-0 basis-full text-caption text-muted">{identity.reason}</span>
      <span className="flex items-center gap-1">
        <Button size="sm" variant={identity.state === 'needs_you' ? 'secondary' : 'quiet'} onClick={() => setOpen(true)} data-testid="vdp-identity-change">
          {identity.state === 'needs_you' ? 'Confirm or change…' : 'Change…'}
        </Button>
        {identity.override ? (
          <Button size="sm" variant="quiet" loading={reset.isPending} onClick={() => reset.mutate()} data-testid="vdp-identity-reset">
            Reset
          </Button>
        ) : null}
      </span>
      {open ? <ChangeDialog identity={identity} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function ChangeDialog({ identity, onClose }: { identity: VdpCompanyIdentity; onClose: () => void }) {
  const qc = useQueryClient();
  const [s, setS] = useState<ChangeState>(() => initialChange(identity));
  const [q, setQ] = useState(identity.pick.kind === 'match' ? identity.pick.name : (identity.accounts[0]?.chain[0] ?? ''));
  const search = useApi('searchVdpCompanies', { query: { q: q.trim() || '-' } }, { enabled: q.trim().length >= 2, staleTime: 60_000 });
  const problem = changeProblem(s);
  const save = useMutation({
    mutationFn: () => api('setVdpIdentity', { body: changeRequest(identity, s) }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['deals'] });
      onClose();
      const name = s.mode === 'match' ? s.match?.name : `create “${s.name.trim()}”`;
      toast({ key: `vdp-identity-${identity.key}`, tone: 'success', title: `VDP company: ${name}`, body: 'Yours: every read keeps it. Nothing was sent to VDP.', ...(r.auditId ? { undo: { auditId: r.auditId } } : {}) });
    },
    onError: (e: ApiError) => toast({ key: `vdp-identity-${identity.key}`, tone: 'error', title: "Couldn't change the company", body: errorText(e, 200) }),
  });
  const options = changeOptions(identity);
  const found = (search.data?.companies ?? []).filter((c) => !options.some((o) => o.pick.kind === 'match' && o.pick.id === c.id));
  const toggle = (id: string) => setS((x) => ({ ...x, accountIds: x.accountIds.includes(id) ? x.accountIds.filter((a) => a !== id) : [...x.accountIds, id] }));
  const pickMatch = (id: string, name: string) => setS((x) => ({ ...x, mode: 'match', match: { id, name } }));
  return (
    <Dialog open onClose={onClose} title="Which VDP company is this?" description="Your pick is kept on every read and used everywhere (the tree, linking, the push). Nothing is sent to VDP from here." confirmLabel={problem ?? 'Save'} onConfirm={() => (problem ? undefined : save.mutate())} busy={save.isPending} width={560}>
      <div className="flex max-h-[60vh] min-w-0 flex-col gap-4 overflow-y-auto" data-testid="vdp-identity-dialog">
        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1 text-caption font-bold tracking-wide text-muted uppercase">The company</legend>
          {options.map((o) => {
            const checked = o.pick.kind === 'match' ? s.mode === 'match' && s.match?.id === o.pick.id : s.mode === 'create' && s.name.trim().toLowerCase() === o.pick.name.toLowerCase();
            return (
              <label key={`${o.pick.kind}:${o.pick.kind === 'match' ? o.pick.id : o.pick.name}`} className={cn('flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5', checked && 'bg-surface-sunken')}>
                <input type="radio" name="vdp-company" className="mt-1" checked={checked} onChange={() => (o.pick.kind === 'match' ? pickMatch(o.pick.id, o.pick.name) : setS((x) => ({ ...x, mode: 'create', match: null, name: o.pick.name })))} />
                <span className="min-w-0">
                  <span className="font-bold text-fg">{o.pick.kind === 'match' ? o.pick.name : `Create “${o.pick.name}”`}</span>
                  <span className="block text-caption text-muted">{o.why}</span>
                </span>
              </label>
            );
          })}
          <label className="mt-2 flex min-w-0 flex-col gap-1 text-caption text-muted">
            <span>Search VDP’s companies</span>
            <input aria-label="Search VDP companies" className="h-8 min-w-0 rounded-md border border-line bg-surface px-2 text-body text-fg" value={q} onChange={(e) => setQ(e.target.value)} placeholder="A name, a slug or an alias" data-testid="vdp-identity-search" />
          </label>
          {found.length ? (
            <ul className="flex min-w-0 flex-col gap-0.5" data-testid="vdp-identity-results">
              {found.map((c) => (
                <li key={c.id}>
                  <label className={cn('flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1', s.mode === 'match' && s.match?.id === c.id && 'bg-surface-sunken')}>
                    <input type="radio" name="vdp-company" className="mt-1" checked={s.mode === 'match' && s.match?.id === c.id} onChange={() => pickMatch(c.id, c.name)} />
                    <span className="min-w-0">
                      <span className="font-bold text-fg">{c.name}</span>
                      <span className="block text-caption text-muted">{[c.aliases.length ? `also ${c.aliases.join(', ')}` : null, c.vdpCount !== null ? `${c.vdpCount} ${c.vdpCount === 1 ? 'VDP' : 'VDPs'}` : null, c.source === 'live' ? 'from VDP just now' : 'from the last read'].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : q.trim().length >= 2 && search.isSuccess ? (
            <p className="px-2 text-caption text-muted">{search.data.note ?? 'No other VDP company by that name.'}</p>
          ) : null}
          <label className={cn('mt-2 flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5', s.mode === 'create' && 'bg-surface-sunken')}>
            <input type="radio" name="vdp-company" className="mt-2" checked={s.mode === 'create'} onChange={() => setS((x) => ({ ...x, mode: 'create', match: null }))} />
            <span className="flex min-w-0 flex-1 flex-col gap-1 text-caption text-muted">
              <span>Create a company with this name</span>
              <input aria-label="New company name" className="h-8 min-w-0 rounded-md border border-line bg-surface px-2 text-body text-fg" value={s.name} onChange={(e) => setS((x) => ({ ...x, mode: 'create', match: null, name: e.target.value }))} data-testid="vdp-identity-name" />
            </span>
          </label>
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="mb-1 text-caption font-bold tracking-wide text-muted uppercase">Org62 accounts in it</legend>
          {[...identity.accounts.map((a) => ({ id: a.id, name: a.name, why: a.chain.length > 1 ? `Under ${a.chain.slice(1).join(' › ')}` : 'Top of its Org62 chain' })), ...identity.candidates].map((a) => (
            <label key={a.id} className="flex min-w-0 cursor-pointer items-start gap-2 px-2 py-1">
              <input type="checkbox" className="mt-1" checked={s.accountIds.includes(a.id)} onChange={() => toggle(a.id)} data-testid="vdp-identity-account" />
              <span className="min-w-0">
                <span className="text-fg">{a.name}</span>
                <span className="block text-caption text-muted">{a.why}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}
