'use client';
/**
 * Settings ▸ Scanning (SCAN-SET): what the scanner turns into work. Instant save, like Display: each pick is one PATCH
 * of `settings.scanning`, and the scanner reads it on its next run (the cc tools enforce it, so it holds even when a
 * model forgets). Defaults suit a teammate without edits (tenet: Low upkeep, team-portable).
 */
import { useCallback, useEffect, useRef } from 'react';
import { DEFAULT_SCANNING_SETTINGS, type ScanningSettings, type Settings } from '@/contract';
import { queryKey } from '@/client/api';
import { useApi } from '@/client/hooks';
import { useOptimisticMutation } from '@/client/optimistic/useOptimisticMutation';
import { toast } from '@/client/toast';
import { SegmentedToggle } from '@/ui';
import { Check } from './controls';
import { Block, Instant, Row, Section } from './form';
import s from './settings.module.css';

type ScanningPatch = Partial<Omit<ScanningSettings, 'version'>>;

export const CHANNEL_ASKS: Record<ScanningSettings['channelAsks'], string> = { ask: 'Ask me', mine: 'Treat as mine', ignore: 'Ignore' };
export const MAPPING_QUESTIONS: Record<ScanningSettings['mappingQuestions'], string> = { mine: 'Mine only', all: 'Anything', never: 'Never' };

/** The nav line: "Group asks: ask me · catch-ups off". */
export function scanningSummary(v: ScanningSettings | undefined): string {
  const x = v ?? DEFAULT_SCANNING_SETTINGS;
  const catchUps = x.meetingCatchUps || x.oppTeamCatchUps ? 'catch-ups on' : 'catch-ups off';
  return `Group asks: ${CHANNEL_ASKS[x.channelAsks].toLowerCase()} · ${catchUps}`;
}

/** Saved value + an instant setter: one request at a time, rapid clicks coalesce into the next PATCH. */
export function useScanningModel() {
  const settings = useApi('getSettings');
  const server = (settings.data as (Settings & { scanning?: ScanningSettings }) | undefined)?.scanning;
  const value: ScanningSettings = server ?? DEFAULT_SCANNING_SETTINGS;
  const persist = useOptimisticMutation({
    route: 'patchSettings',
    topics: ['settings'],
    writeBack: false,
    // Last write wins: a 409 carries the whole Settings as `current`, so rebase on current.scanning.version.
    rebase: ({ input, current }) => {
      const v = Number((current as unknown as Partial<Settings>).scanning?.version ?? current.version);
      return Number.isFinite(v) ? { ...input, body: { ...input.body!, ifVersion: v } } : null;
    },
    entityId: () => undefined,
    optimistic: (input, cache) => cache.setQuery<Settings>(queryKey('getSettings') as never, (old) => (old ? ({ ...old, scanning: { ...(old.scanning ?? DEFAULT_SCANNING_SETTINGS), ...input.body!.value } } as Settings) : old)),
    onError: () => toast({ key: 'scanning-save', tone: 'warning', title: "Couldn't save scanning settings", body: 'The scanner keeps the last saved choice.', action: { label: 'Retry', onClick: () => persist.retry() } }),
  });
  const queue = useRef<ScanningPatch | null>(null);
  const inflight = useRef(false);
  const lastVersion = useRef(0);
  const latest = useRef({ persist, version: server?.version ?? 0 });
  latest.current = { persist, version: server?.version ?? 0 };
  const flush = useCallback(() => {
    if (inflight.current || !queue.current || !latest.current.version) return;
    const patch = queue.current;
    queue.current = null;
    inflight.current = true;
    latest.current.persist
      .mutateAsync({ params: { section: 'scanning' }, body: { ifVersion: Math.max(lastVersion.current, latest.current.version), value: patch } })
      .then((res) => {
        lastVersion.current = (res.entity as Settings).scanning?.version ?? lastVersion.current;
      })
      .catch(() => undefined)
      .finally(() => {
        inflight.current = false;
        flush();
      });
  }, []);
  useEffect(() => flush(), [flush, server?.version]);
  const set = useCallback(
    (patch: ScanningPatch) => {
      queue.current = { ...queue.current, ...patch };
      flush();
    },
    [flush],
  );
  return { value, ready: !!server, set };
}

export function ScanningSection() {
  const m = useScanningModel();
  const v = m.value;
  return (
    <Section id="scanning" title="Scanning" meta="What the scanner turns into work. Changes apply from the next scan; nothing already on your list moves." actions={<Instant />}>
      <Block title="Asks" help="Who an ask is for decides whether it becomes your item.">
        <Row label="Asks to a whole channel" labelId="l-chan-asks" help="@channel, @here, or a list of three or more people with you among them. “Ask me” puts them in Triage for you to decide.">
          <SegmentedToggle
            size="md"
            label="Asks to a whole channel"
            value={v.channelAsks}
            onChange={(x) => m.set({ channelAsks: x })}
            options={(Object.keys(CHANNEL_ASKS) as Array<ScanningSettings['channelAsks']>).map((k) => ({ value: k, label: CHANNEL_ASKS[k] }))}
          />
        </Row>
        <Row label="“Where does this belong?”" labelId="l-mapping" help="The Triage question after the scanner fails three times to find a home for a message. “Mine only”: just for asks of you and promises of yours; for anything else it stops asking.">
          <SegmentedToggle
            size="md"
            label="Where does this belong?"
            value={v.mappingQuestions}
            onChange={(x) => m.set({ mappingQuestions: x })}
            options={(Object.keys(MAPPING_QUESTIONS) as Array<ScanningSettings['mappingQuestions']>).map((k) => ({ value: k, label: MAPPING_QUESTIONS[k] }))}
          />
        </Row>
      </Block>
      <Block title="Catch-up items" help="Off by default: on a first scan they were mostly noise.">
        <Row label="Missed-meeting catch-ups" help="A “Catch up: <meeting>” item when the notes of a meeting you missed decide something on your account.">
          <Check checked={v.meetingCatchUps} disabled={!m.ready} onChange={(x) => m.set({ meetingCatchUps: x })} testId="scan-meeting-catchups">
            Make catch-up items
          </Check>
        </Row>
        <Row label="“Get up to speed” on opp-team adds" help="An item in Triage when you are added to an opportunity team. The opp shows on the Opps page either way.">
          <Check checked={v.oppTeamCatchUps} disabled={!m.ready} onChange={(x) => m.set({ oppTeamCatchUps: x })} testId="scan-opp-catchups">
            Make “Get up to speed” items
          </Check>
        </Row>
      </Block>
    </Section>
  );
}

/** The effect pane: what the current choices do, in plain words. */
export function ScanningEffect() {
  const v = useScanningModel().value;
  const lines = [
    v.channelAsks === 'ask' ? 'An @channel or list ask waits in Triage until you take it or dismiss it.' : v.channelAsks === 'mine' ? 'An @channel or list ask lands on your list like a direct ask.' : 'An @channel or list ask never becomes an item.',
    v.mappingQuestions === 'mine' ? 'Triage asks where a message belongs only when it is an ask of you or a promise of yours.' : v.mappingQuestions === 'all' ? 'Triage asks where any unlinked message belongs.' : 'Triage never asks where a message belongs.',
    v.meetingCatchUps ? 'A missed meeting that decides something on your account becomes a catch-up item.' : 'Missed meetings make no catch-up items.',
    v.oppTeamCatchUps ? 'Joining an opp team adds a “Get up to speed” item to Triage.' : 'Joining an opp team adds no item.',
  ];
  return (
    <div className={s.block} data-testid="scanning-effect">
      <div className={s.blockHead}>
        <h3>What the next scan does</h3>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
