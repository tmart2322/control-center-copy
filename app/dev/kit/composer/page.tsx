'use client';
/**
 * /dev/kit/composer: every Composer state on one page, against the mock API (CC_DATA=mock).
 * On load it resets the mock store and puts seeded drafts into the states shown (one PATCH or dev call each).
 * Nothing here can reach an external system: the mock DataSource never calls out, dry run or not.
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DraftPreview, Settings } from '@/contract';
import { api } from '@/client/api';
import { useApi } from '@/client/hooks';
import {
  Composer,
  ComposerInline,
  ConfirmSendDialog,
  DestinationChip,
  SendCountdownToast,
  switchOptions,
  type ComposerHandle,
} from '@/components/composer';
import { Button, Dialog, Icon, StatePill, cx } from '@/components/composer/_bits';
import { DANA_DM, INITECH_BROADCAST_DOC, ONEPAGER_DEST, ONEPAGER_RICH_DOC, PRIYA_LIST_DOC, appendParagraph, theirEdit } from './fixtures';

const IDS = {
  thread: 'dr_dana',
  dmList: 'dr_priya',
  replyAll: 'dr_globex_sow',
  proposal: 'dr_nce',
  saveFail: 'dr_nudge_globex',
  conflict: 'dr_onepager',
  inline: 'dr_chat_initech',
  readOnly: 'dr_sent_sso',
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noScript = () => new URLSearchParams(window.location.search).has('noscript');

/** Wait for 400 ms with no query in flight (so the global fail switch only hits the demo's PATCH). */
async function settle(qc: QueryClient, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  let quietSince = Date.now();
  while (Date.now() < end) {
    if (qc.isFetching() > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 400) return;
    await sleep(50);
  }
}

type SetupState = { phase: 'running' | 'ready' | 'error'; message?: string };

/** One setup per kit generation, shared by React strict mode's double effect run. */
const setups = new Map<number, Promise<void>>();
function prepareOnce(gen: number, skip: boolean): Promise<void> {
  let p = setups.get(gen);
  if (!p) {
    p = skip ? Promise.resolve() : prepareMock();
    setups.set(gen, p);
  }
  return p;
}

async function prepareMock(): Promise<void> {
  await api('controlScenario', { body: { action: 'reset' } });
  await api('setDevFail', { body: { rate: 0 } });
  // Slack DM with a real list → rich_text blocks.
  const priya = await api('getDraft', { params: { id: IDS.dmList } });
  await api('patchDraft', { params: { id: IDS.dmList }, body: { ifVersion: priya.version, doc: PRIYA_LIST_DOC } });
  // A channel post with @here (broadcast warning).
  const initech = await api('getDraft', { params: { id: IDS.inline } });
  await api('patchDraft', { params: { id: IDS.inline }, body: { ifVersion: initech.version, doc: INITECH_BROADCAST_DOC } });
  // A draft the user touched, then an engine proposes a change (never an overwrite).
  const prop = await api('getDraft', { params: { id: IDS.proposal } });
  await api('patchDraft', { params: { id: IDS.proposal }, body: { ifVersion: prop.version, doc: appendParagraph(prop.doc, 'Happy to walk you through it on Thursday.') } });
  await api('devEngineChange', {
    body: { entityType: 'draft', id: IDS.proposal, patch: { text: 'Nora also asked whether the product covers the consent model; I added it to the list.' }, reason: 'Nora asked about the consent model in #hooli-ext' },
  });
}

export default function ComposerKitPage() {
  const qc = useQueryClient();
  const [gen, setGen] = useState(0);
  const [setup, setSetup] = useState<SetupState>({ phase: 'running' });
  const settingsQ = useApi('getSettings');
  const failRef = useRef<ComposerHandle>(null);
  const conflictRef = useRef<ComposerHandle>(null);
  const [scripted, setScripted] = useState<string>('');

  useEffect(() => {
    if (!document.documentElement.dataset.sfTheme) document.documentElement.dataset.sfTheme = 'lightning-blue';
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSetup({ phase: 'running' });
    (async () => {
      try {
        const skip = new URLSearchParams(window.location.search).has('noreset');
        await prepareOnce(gen, skip);
        if (cancelled) return;
        qc.clear();
        if (!cancelled) setSetup({ phase: 'ready' });
      } catch (err) {
        if (!cancelled) setSetup({ phase: 'error', message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gen, qc]);

  // Scripted states that need a live failure: autosave failure (dev fail switch) and a 409.
  useEffect(() => {
    if (setup.phase !== 'ready') return;
    let cancelled = false;
    (async () => {
      await sleep(1200);
      await settle(qc);
      if (cancelled || noScript()) return setScripted('');
      setScripted('Running: autosave failure');
      // The fail switch is global, so keep the window to this one PATCH.
      failRef.current?.appendText('I can send the redline summary today.');
      await api('setDevFail', { body: { rate: 1 } });
      await failRef.current?.flush();
      await api('setDevFail', { body: { rate: 0 } });
      if (cancelled) return;
      setScripted('Running: changed elsewhere');
      // Unsaved local edit, then "another tab" saves first: the live refetch (or the stale ifVersion) surfaces the conflict.
      conflictRef.current?.appendText('I also attached the data-flow diagram.');
      const cur = await api('getDraft', { params: { id: IDS.conflict } });
      await api('patchDraft', { params: { id: IDS.conflict }, body: { ifVersion: cur.version, doc: theirEdit(cur.doc) } });
      // Save now with the stale ifVersion → 409 (unless the live refetch already flagged the conflict).
      await conflictRef.current?.flush();
      if (!cancelled) setScripted('');
    })().catch((err: Error) => setScripted(`Script failed: ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, [setup.phase, gen, qc]);

  const ready = setup.phase === 'ready';
  return (
    <div className="min-h-screen">
      <KitHeader settings={settingsQ.data} onReset={() => setGen((g) => g + 1)} status={setup.phase === 'running' ? 'Preparing mock drafts…' : scripted} />
      {setup.phase === 'error' ? (
        <p className="m-6 rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-body text-danger-700">
          The mock API didn’t answer ({setup.message}). Start it with <code className="font-mono">npm run dev:web</code> (CC_DATA=mock).
        </p>
      ) : null}
      <main key={gen} className="grid grid-cols-1 gap-x-6 gap-y-8 px-6 pt-5 pb-16 min-[1400px]:grid-cols-2 min-[2200px]:grid-cols-3">
        <Specimen n="1" title="Slack thread reply" note="Untouched AI draft (agentic border, one sparkle) with the last three thread messages above it. The toolbar disables headings: Slack can’t render them.">
          {ready ? <Composer draftId={IDS.thread} /> : <Placeholder />}
        </Specimen>

        <Specimen n="2" title="Slack DM with a list" note="A real bullet list and a resolved mention pill. The payload switches to rich_text blocks with a mrkdwn fallback; View payload shows the exact JSON.">
          {ready ? <Composer draftId={IDS.dmList} defaultShowPayload /> : <Placeholder />}
        </Specimen>

        <Specimen n="3" title="Email reply-all" note="Gmail HTML profile: every tool is enabled. Edited by you, so the agentic border is gone and the save status shows.">
          {ready ? <Composer draftId={IDS.replyAll} /> : <Placeholder />}
        </Specimen>

        <Specimen n="4" title="Switching channel shows what’s lost" note="Email → Slack DM. lossyForSwitch lists every conversion before anything changes; Switch applies it.">
          <LossySpecimen />
        </Specimen>

        <Specimen n="5" title="Touched draft receives a proposal" note="New info arrived after you edited. The engine proposes instead of overwriting: Apply or Keep mine.">
          {ready ? <Composer draftId={IDS.proposal} /> : <Placeholder />}
        </Specimen>

        <Specimen n="6" title="Autosave failure" note="The dev fail switch (POST /api/v1/dev/fail) makes the PATCH fail. The cache rolls back, the text stays, and Retry saves it.">
          {ready ? <Composer draftId={IDS.saveFail} ref={failRef} /> : <Placeholder />}
        </Specimen>

        <Specimen n="7" title="Changed elsewhere (409)" note="Another tab saved first. The stale ifVersion gets a 409; the composer shows both versions and lets you choose.">
          {ready ? <Composer draftId={IDS.conflict} ref={conflictRef} /> : <Placeholder />}
        </Specimen>

        <Specimen n="8" title="Undo window" note="After confirm, the send button becomes a 10 s countdown with Undo in the same spot. Undo cancels before anything is dispatched.">
          <CountdownSpecimen />
        </Specimen>

        <Specimen n="9" wide title="Confirm: dry run vs live" note="Rendered from the server’s preview payload (the bytes the confirm token binds). Cancel has focus; Confirm is the only primary. Specimens: buttons are inert.">
          <ConfirmSpecimens ready={ready} />
        </Specimen>

        <Specimen n="10" title="Read-only preview" note="A sent, verified Slack reply. Preview as recipient, from the payload; no editing, no sending.">
          {ready ? <Composer draftId={IDS.readOnly} readOnly /> : <Placeholder />}
        </Specimen>

        <Specimen n="11" title="Inline (NbaCard expanded)" note="ComposerInline: same editor and send border, compact chrome. The draft uses @here, so the header warns before anyone is notified.">
          {ready ? <ComposerInline draftId={IDS.inline} /> : <Placeholder />}
        </Specimen>
      </main>
    </div>
  );
}

function KitHeader({ settings, onReset, status }: { settings?: Settings; onReset: () => void; status: string }) {
  const qc = useQueryClient();
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const dryRun = settings?.sending.dryRun ?? true;

  const setDryRun = async (on: boolean) => {
    if (!settings) return;
    setBusy(true);
    try {
      const { version: _v, ...value } = settings.sending;
      await api('patchSettings', { params: { section: 'sending' }, body: { ifVersion: settings.sending.version, value: { ...value, dryRun: on }, confirm: !on } });
      await qc.invalidateQueries({ queryKey: ['settings'] });
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-surface px-6 shadow-header">
      <span className="grid size-7 place-items-center rounded-md bg-gradient-brand text-white">
        <Icon name="send" size={14} />
      </span>
      <h1 className="text-title">Composer kit</h1>
      <span className="font-mono text-caption text-muted">/dev/kit/composer · mock</span>
      {status ? <span className="text-caption text-muted">{status}</span> : null}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-caption text-muted">Global send mode</span>
        {dryRun ? (
          <StatePill tone="warn" icon="lock" className="font-bold">
            Dry run on
          </StatePill>
        ) : (
          <StatePill tone="risk" icon="send" className="font-bold">
            Live (mock simulates)
          </StatePill>
        )}
        <Button size="sm" variant="neutral" disabled={!settings || busy} onClick={() => (dryRun ? setConfirmOff(true) : void setDryRun(true))}>
          {dryRun ? 'Turn dry run off' : 'Turn dry run on'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset}>
          <Icon name="refresh" size={12} />
          Reset mock
        </Button>
      </div>
      <Dialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="Turn dry run off?"
        description="Send and Push will post for real once wired. In mock mode nothing leaves this machine: the mock simulates the send and the read-back."
        footer={
          <>
            <Button variant="neutral" data-autofocus onClick={() => setConfirmOff(false)}>
              Keep dry run
            </Button>
            <Button variant="primary" onClick={() => void setDryRun(false)} loading={busy}>
              Turn dry run off
            </Button>
          </>
        }
      />
    </header>
  );
}

function Specimen({ n, title, note, children, wide }: { n: string; title: string; note: string; children: ReactNode; wide?: boolean }) {
  return (
    <section id={`s${n}`} data-specimen={n} className={cx('min-w-0', wide && 'col-span-full')}>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-mono text-caption text-faint tabular-nums">{n.padStart(2, '0')}</span>
        <h2 className="text-title">{title}</h2>
      </div>
      <p className="mb-3 max-w-[72ch] text-body text-muted">{note}</p>
      {children}
    </section>
  );
}

function Placeholder() {
  return <div aria-busy className="h-56 animate-pulse rounded-lg border border-line bg-surface" />;
}

function LossySpecimen() {
  const candidates = useMemo(() => [ONEPAGER_DEST, DANA_DM], []);
  // No people passed: Raj has no Slack id here, so the lossy list also shows the mention falling back to a name.
  const options = useMemo(() => switchOptions(ONEPAGER_DEST, ONEPAGER_RICH_DOC, candidates, []), [candidates]);
  const [open, setOpen] = useState(true);
  return (
    <div className="h-[22rem] rounded-lg border border-dashed border-line-strong bg-surface-muted p-4">
      <DestinationChip destination={ONEPAGER_DEST} options={options} open={open} onOpenChange={setOpen} onSwitch={() => setOpen(false)} defaultPicked={0} />
    </div>
  );
}

function ConfirmSpecimens({ ready }: { ready: boolean }) {
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  useEffect(() => {
    if (!ready) return;
    api('previewDraft', { params: { id: IDS.thread }, body: { mode: 'send' } })
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [ready]);
  if (!preview) return <Placeholder />;
  const noop = () => undefined;
  return (
    <div className="grid grid-cols-1 gap-4 min-[1400px]:grid-cols-2">
      {[true, false].map((dry) => (
        <div key={String(dry)} className="flex flex-col items-center rounded-lg bg-ink-900/40 p-4">
          <div className="w-full max-w-[44rem]">
          <p className="mb-2 text-caption font-bold text-white">{dry ? 'Dry run on (default)' : 'Dry run off'}</p>
          <ConfirmSendDialog
            inline
            open
            mode="send"
            destination={preview.destination}
            preview={{ ...preview, dryRun: dry }}
            dryRun={dry}
            undoSec={10}
            labels={{}}
            senderName="Jordan Lee"
            onConfirm={noop}
            onCancel={noop}
          />
          </div>
        </div>
      ))}
    </div>
  );
}

function CountdownSpecimen() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [undone, setUndone] = useState(false);
  useEffect(() => setDeadline(Date.now() + 7_000), []);
  useEffect(() => {
    if (undone || deadline == null) return;
    const t = setInterval(() => setDeadline((d) => (d != null && d <= Date.now() ? Date.now() + 10_000 : d)), 250);
    return () => clearInterval(t);
  }, [undone, deadline]);
  if (deadline == null) return <Placeholder />;
  return (
    <div className={cx('rounded-lg border border-line bg-surface p-4 shadow-card')}>
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <span className="text-caption text-muted">Composer footer during the window</span>
      </div>
      <div className="flex items-center justify-end gap-2 pt-3">
        {undone ? (
          <span className="inline-flex items-center gap-1.5 text-caption text-muted">
            <Icon name="undo" size={12} />
            Undone. Nothing was sent.
            <button type="button" className="ml-2 text-link hover:underline" onClick={() => (setUndone(false), setDeadline(Date.now() + 10_000))}>
              Replay
            </button>
          </span>
        ) : (
          <SendCountdownToast deadline={deadline} durationMs={10_000} label="Sending to #acme-ext" dryRun onUndo={() => setUndone(true)} autoFocusUndo={false} className="min-w-80" />
        )}
      </div>
      <p className="mt-4 text-caption text-muted">Floating variant (Outbox), bottom-left:</p>
      <div className="relative mt-2 h-16 overflow-hidden rounded-md bg-surface-muted">
        <SendCountdownToast deadline={deadline} durationMs={10_000} label="Pushing Gmail draft to Marcus Webb" onUndo={noopUndo} autoFocusUndo={false} variant="floating" className="absolute! bottom-2! left-2!" />
      </div>
    </div>
  );
}

const noopUndo = () => undefined;
