/**
 * Why VDP refused an AE or TA list, in words you can act on (2026-11-16, owner: "make it clear that they're not in VDP
 * and what the action is"; "I add them myself in VDP").
 *
 * VDP's `set_vdp_owners` sets a person only when they are an active VDP user, and an AE only with a sales VDP role (a
 * TA, a technical one). VDP has no read tool for its users, and its refusal reached the app as "Delivery failed for an
 * unknown reason". What the app does know, from its own reads: who is on any VDP it has read (as AE, TA, collaborator
 * or creator), and whom VDP took as AE or TA in an owners call that landed. A refused list names the people VDP has
 * never shown, and the one action: add them in VDP, then push again. Someone VDP has, but never as that role, needs
 * the role. When everyone on the list is known, the refusal is something else and the detail stays as it was.
 *
 * Pure: no IO. Read by the coverage payload (src/server/vdp/coverage.ts) for every push run, so a run that failed
 * before this existed reads the same way.
 */
import type { VdpPushRun } from '@/contract';
import type { VdpPerson } from '@/lib/vdp/types';

export type OwnerField = 'account_executives' | 'technical_architects';

/** Who VDP has shown the app, by lowercased email. */
export interface VdpPeople {
  /** On any VDP the app read (any role), or set by an owners call that landed. */
  inVdp: ReadonlySet<string>;
  /** VDP lists them as an AE somewhere, or took them as AE. */
  asAe: ReadonlySet<string>;
  /** VDP lists them as a TA somewhere, or took them as TA. */
  asTa: ReadonlySet<string>;
  /** Display names (VDP's, then the Specialist Forecast's). */
  names: ReadonlyMap<string, string>;
}

/** An owners call: the role's list it sends (and the list it replaces). */
export interface OwnersCall {
  field: OwnerField;
  emails: readonly string[];
  before?: readonly string[];
}

const low = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

export function vdpPeople(o: {
  vdps: readonly { aes: readonly VdpPerson[]; tas: readonly VdpPerson[]; collaborators: readonly VdpPerson[]; createdBy: VdpPerson | null }[];
  /** Owners calls VDP took (sent or verified). */
  applied?: readonly OwnersCall[];
  /** More names (the Specialist Forecast owners). */
  names?: Iterable<readonly [string, string | null]>;
}): VdpPeople {
  const inVdp = new Set<string>();
  const asAe = new Set<string>();
  const asTa = new Set<string>();
  const names = new Map<string, string>();
  const add = (p: VdpPerson | null, role?: Set<string>) => {
    const e = low(p?.email);
    if (!e) return;
    inVdp.add(e);
    role?.add(e);
    if (p?.name && !names.has(e)) names.set(e, p.name);
  };
  for (const v of o.vdps) {
    for (const p of v.aes) add(p, asAe);
    for (const p of v.tas) add(p, asTa);
    for (const p of v.collaborators) add(p);
    add(v.createdBy);
  }
  for (const c of o.applied ?? []) {
    for (const e of c.emails.map(low).filter(Boolean)) {
      inVdp.add(e);
      (c.field === 'account_executives' ? asAe : asTa).add(e);
    }
  }
  for (const [e, n] of o.names ?? []) if (low(e) && n && !names.has(low(e))) names.set(low(e), n);
  return { inVdp, asAe, asTa, names };
}

const join = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * Why VDP refused this list: "Not in VDP yet: <names>. Add them in VDP with a sales role, then push again." Only the
 * people the call adds count (whoever is on the list already, VDP has). null: everyone is known, so it says nothing.
 */
export function ownersRefusal(call: OwnersCall, people: VdpPeople): string | null {
  const ae = call.field === 'account_executives';
  const role = ae ? 'AE' : 'TA';
  const kind = ae ? 'sales' : 'technical';
  const has = ae ? people.asAe : people.asTa;
  const before = new Set((call.before ?? []).map(low));
  const added = [...new Set(call.emails.map(low).filter((e) => e && !before.has(e)))];
  const name = (e: string) => people.names.get(e) ?? e;
  const missing = added.filter((e) => !people.inVdp.has(e));
  const noRole = added.filter((e) => people.inVdp.has(e) && !has.has(e));
  if (!missing.length && !noRole.length) return null;
  const parts = [`VDP refused the ${role} list.`];
  if (missing.length) parts.push(`Not in VDP yet: ${join(missing.map(name))}. Add ${missing.length === 1 ? 'them' : 'each of them'} in VDP with a ${kind} role, then push again.`);
  if (noRole.length) parts.push(`In VDP without a ${kind} role: ${join(noRole.map(name))}. Give ${noRole.length === 1 ? 'them' : 'each of them'} one in VDP, then push again.`);
  return parts.join(' ');
}

/** A delivery failure VDP answered with no reason the app could read (the generic Outbox classes). */
const UNEXPLAINED = /\((?:unknown|invalid_request)\)/;

/**
 * Every failed owners item of these runs, explained (`ownersRefusal`), when its detail was the generic one. `callOf`
 * reads the item's call from its draft (null: not an owners call, or the draft is gone).
 */
export function explainOwnerRefusals(runs: readonly VdpPushRun[], callOf: (draftId: string) => OwnersCall | null, people: VdpPeople): VdpPushRun[] {
  return runs.map((r) => {
    let changed = false;
    const nodes = r.nodes.map((n) => {
      if (n.op !== 'set_vdp_owners' || n.state !== 'failed' || !n.draftId || !UNEXPLAINED.test(n.detail ?? '')) return n;
      const call = callOf(n.draftId);
      const why = call ? ownersRefusal(call, people) : null;
      if (!why) return n;
      changed = true;
      return { ...n, detail: why };
    });
    return changed ? { ...r, nodes } : r;
  });
}

/** The owners call a VDP draft makes (`vdp.set_vdp_owners`), from its action input. */
export function ownersCallOf(d: { destination: { kind: string; action?: string; input?: unknown } }): OwnersCall | null {
  if (d.destination.kind !== 'action' || d.destination.action !== 'vdp.set_vdp_owners') return null;
  const i = (d.destination.input ?? {}) as { field?: unknown; value?: unknown; before?: unknown; changes?: Array<{ field?: unknown; value?: unknown; before?: unknown }> };
  const c = Array.isArray(i.changes) && i.changes.length ? i.changes[0]! : i;
  const field = c.field === 'account_executives' || c.field === 'technical_architects' ? c.field : null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? v.split(/[,\s]+/).filter(Boolean) : []);
  return field ? { field, emails: list(c.value), before: list(c.before) } : null;
}
