/**
 * Time ▸ VDP ▸ Changes, a company node's identity (D-69, pure): the line under the company ("VDP has Globex · by its
 * name up the Org62 chain"), its badge (color = state: act for Needs you, AI for the judgment, neutral otherwise), and
 * what Change… starts from (the current pick pre-selected, the alternatives, the accounts in it and the ones you can
 * add) and sends (`setVdpIdentity`).
 */
import type { SetVdpIdentityRequest, VdpCompanyIdentity, VdpIdentityPick } from '@/contract';

export interface IdentityBadge {
  tone: 'now' | 'ai' | 'neutral' | 'warning';
  icon: string;
  text: string;
}

const BY: Record<VdpCompanyIdentity['by'], string> = {
  vdp: 'a VDP of yours links it',
  name: "VDP's own name rule, up the Org62 chain",
  rules: 'no match in VDP: the closest plain parent',
  judgment: 'the app’s judgment',
  you: 'you, with Change…',
};

/** What the node says about its company, in one badge and one line. */
export function identityBadge(id: VdpCompanyIdentity): IdentityBadge {
  switch (id.state) {
    case 'needs_you':
      return { tone: 'now', icon: 'warning', text: 'Needs you' };
    case 'not_looked_up':
      return { tone: 'neutral', icon: 'clock', text: 'Not looked up yet' };
    case 'hidden_vdps':
      return { tone: 'warning', icon: 'lock', text: `${id.hiddenVdps} ${id.hiddenVdps === 1 ? 'VDP' : 'VDPs'} you’re not on` };
    case 'tombstoned':
      return { tone: 'neutral', icon: 'archive', text: 'Archived in VDP' };
    default:
      if (id.by === 'you') return { tone: 'neutral', icon: 'user', text: 'Yours' };
      if (id.by === 'judgment') return { tone: 'ai', icon: 'sparkles', text: `Suggested · ${Math.round(id.confidence * 100)}%` };
      return { tone: 'neutral', icon: 'check', text: id.pick.kind === 'match' ? 'In VDP' : 'New company' };
  }
}

/** "VDP has “Globex” · by VDP's own name rule · 2 accounts" / "Best guess: create “Nexus Care” · 2 other options". */
export function identityLine(id: VdpCompanyIdentity): string {
  const what = id.pick.kind === 'match' ? `VDP has “${id.pick.name}”` : `Create “${id.pick.name}”${id.pick.aliases.length ? ` (also known as ${id.pick.aliases.map((a) => `“${a}”`).join(', ')})` : ''}`;
  const head = id.state === 'needs_you' ? `Best guess: ${what.charAt(0).toLowerCase()}${what.slice(1)}` : what;
  const parts = [head, `by ${BY[id.by]}`];
  if (id.accounts.length > 1) parts.push(`${id.accounts.length} Org62 accounts`);
  if (id.alternatives.length && id.state === 'needs_you') parts.push(`${id.alternatives.length} other ${id.alternatives.length === 1 ? 'option' : 'options'}`);
  return parts.join(' · ');
}

export interface ChangeState {
  mode: 'match' | 'create';
  match: { id: string; name: string } | null;
  name: string;
  accountIds: string[];
}

/** Change… opens on the current pick (the best guess when it needs you), the node's accounts ticked. */
export function initialChange(id: VdpCompanyIdentity): ChangeState {
  return {
    mode: id.pick.kind,
    match: id.pick.kind === 'match' ? { id: id.pick.id, name: id.pick.name } : null,
    name: id.pick.kind === 'create' ? id.pick.name : (id.accounts[0]?.chain[0] ?? id.accounts[0]?.name ?? ''),
    accountIds: id.accounts.map((a) => a.id),
  };
}

/** The options Change… lists first: the current pick, then the alternatives (matches and companies to create). */
export function changeOptions(id: VdpCompanyIdentity): Array<{ pick: VdpIdentityPick; why: string }> {
  const cur = { pick: id.pick, why: id.state === 'needs_you' ? 'The app’s best guess' : 'Now' };
  const seen = new Set([key(id.pick)]);
  return [cur, ...id.alternatives.filter((a) => !seen.has(key(a.pick)) && seen.add(key(a.pick))).map((a) => ({ pick: a.pick, why: a.why }))];
}
const key = (p: VdpIdentityPick) => (p.kind === 'match' ? `m:${p.id}` : `c:${p.name.toLowerCase()}`);

/** Why Save can't go yet, else null. */
export function changeProblem(s: ChangeState): string | null {
  if (!s.accountIds.length) return 'Pick at least one Org62 account';
  if (s.mode === 'match' && !s.match) return 'Pick a VDP company';
  if (s.mode === 'create' && !s.name.trim()) return 'Type the company name';
  return null;
}

/** The request Save sends (the node's primary account first, so the node keeps its place). */
export function changeRequest(id: VdpCompanyIdentity, s: ChangeState): SetVdpIdentityRequest {
  const primary = id.accounts[0]?.id;
  const ordered = primary && s.accountIds.includes(primary) ? [primary, ...s.accountIds.filter((a) => a !== primary)] : s.accountIds;
  const pick: VdpIdentityPick = s.mode === 'match' && s.match ? { kind: 'match', id: s.match.id, name: s.match.name } : { kind: 'create', name: s.name.trim(), aliases: [] };
  return { key: id.key, accountIds: ordered, pick };
}
