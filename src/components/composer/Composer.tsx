'use client';
/**
 * Composer (UI-SPEC §7, R-UI-5): one TipTap document, per-destination capability profiles, preview from the
 * serialized payload, autosave with ifVersion, proposals instead of overwrites, and the border:
 * Draft ↔ Send → confirm → 10 s undo → dispatch → read-back. Nothing leaves without an explicit
 * Send/Push plus a confirm.
 *
 * Keys (when focus is inside): ⌘↵ primary · ⌥P preview · ⌘⇧C switch channel · ⌘/ AI chips · Esc blur ·
 * ⌘Z undo during the countdown.
 *
 * v2 (DESIGN-V2): calm chrome, reading text ≤ 68ch at 16/24, the destination as a neutral label, one
 * filled primary. `primaryPlacement="external"` hands the primary (and the countdown's Undo) to the host,
 * e.g. the docked panel's sticky footer, through `onPrimaryChange`; the Draft/Send toggle stays here.
 */
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type Ref } from 'react';
import type { Destination, DispatchMode, DispatchResult, Draft, Person, Proposal, TipTapDoc } from '@/contract';
import { isAdminDraft } from '@/contract';
import { api, queryKey, urlFor, type ApiError } from '@/client/api';
import { useApi } from '@/client/hooks';
import { serialize, type DocNode } from '@/lib/compose';
import { AiChips, type RewriteInstruction } from './AiChips';
import { DraftAutosave } from './autosave';
import { ConfirmSendDialog } from './ConfirmSendDialog';
import { DestinationChip } from './DestinationChip';
import {
  channelName,
  destinationLabel,
  destinationShort,
  mentionCandidates,
  mentionLabels,
  profileFor,
  switchCandidates,
  switchOptions,
  threadPeople,
  toComposeDestination,
} from './destination';
import { ConflictBanner, DraftProposal } from './DraftProposal';
import { composerExtensions, type ComposerEditorContext } from './extensions';
import { PayloadPanel } from './PayloadPanel';
import { docKey, payloadView, previewParity } from './preview';
import { ActionPreview } from './ActionPreview';
import { CanvasReview } from './CanvasReview';
import { RecipientPreview } from './RecipientPreview';
import { SendCountdownToast } from './SendCountdownToast';
import { SendFlow, type SendOutcome, type SendState } from './send-flow';
import { EDITOR_PROSE } from './styles';
import { lineChanges } from './text-diff';
import { ThreadContext } from './ThreadContext';
import { Toolbar } from './Toolbar';
import { Button, Icon, InlineStatus, SegmentedToggle, StatePill } from '@/ui';
import { Tooltip, cx } from './_bits';
import { stagedLabel, stagedWhere } from '@/components/lists/outbox';

/** "Pushed as Slack draft · find it in Slack ▸ Drafts": a pushed draft waits in its app for you to send it. */
function stagedLine(destination: Draft['destination'], channel: string): string {
  const where = stagedWhere(destination);
  return `${stagedLabel(destination) ?? `Pushed as ${channel} draft`}${where ? ` · find it ${where}` : ''}`;
}

export interface ComposerHandle {
  focus(): void;
  /** Append a paragraph as if typed (marks the draft touched, schedules autosave). Doesn't move focus. */
  appendText(text: string): void;
  /** Save now. Resolves true when nothing is left unsaved. */
  flush(): Promise<boolean>;
  /** Same as the primary button: opens the confirm for the current Draft/Send mode. */
  send(): void;
  /** Cancel a running send countdown (no-op otherwise). */
  undo(): void;
  getDoc(): TipTapDoc | null;
}

/** What the host draws when it owns the primary (`primaryPlacement="external"`). */
export interface ComposerPrimaryState {
  label: string;
  icon: 'send' | 'edit';
  disabled: boolean;
  loading: boolean;
  /** Why it can't send yet ("Write something first"). */
  blockedReason: string | null;
  mode: DispatchMode;
  /** While the undo window runs, the host shows the countdown with Undo in place of the button. */
  countdown: { deadline: number; durationMs: number; label: string; dryRun: boolean } | null;
  /** "Rendering…" / "Sending to Slack…" while dispatching. */
  busyLabel: string | null;
  /** Final or read-only: no primary at all. */
  hidden: boolean;
}

export interface ComposerProps {
  /** Load the draft by id (GET /drafts/:id). */
  draftId?: string;
  /** Or pass it (seeds the cache; the composer still saves to PATCH /drafts/:id). */
  draft?: Draft;
  /** Preview-only: no editing, no sending. */
  readOnly?: boolean;
  /** People on this work: mention candidates (with Slack ids / emails) and switch targets. Merged with the item's initiative people. */
  people?: Person[];
  /** Extra destinations offered by the destination chip. */
  destinations?: Destination[];
  /** Start in "Preview as recipient". */
  defaultPreview?: boolean;
  /** Start with "View payload" open. */
  defaultShowPayload?: boolean;
  autoFocus?: boolean;
  onSaved?: (draft: Draft) => void;
  /** Dispatch finished (dry run, staged or sent). `result` is null when the backend answered `dry_run` (423). */
  onDispatched?: (result: DispatchResult | null, outcome: SendOutcome) => void;
  onSendStateChange?: (state: SendState) => void;
  className?: string;
  ref?: Ref<ComposerHandle>;
  /** Compact chrome (ComposerInline). */
  variant?: 'full' | 'inline';
  /** Inline only: "Open full composer". */
  onExpand?: () => void;
  /** `external`: don't draw the Send/Push button or the countdown; report them through onPrimaryChange. */
  primaryPlacement?: 'footer' | 'external';
  onPrimaryChange?: (state: ComposerPrimaryState) => void;
}

type PersonLike = Pick<Person, 'id' | 'name'> & Partial<Pick<Person, 'email' | 'slackHandle' | 'isExternal'>>;

const FINAL_STATUSES: Draft['status'][] = ['sending', 'sent', 'staged', 'verified'];

export function Composer(props: ComposerProps) {
  const id = props.draftId ?? props.draft?.id ?? '';
  const q = useApi('getDraft', { params: { id } }, { enabled: !!id, initialData: props.draft });
  const inline = props.variant === 'inline';
  if (!id) return <ComposerShell inline={inline} className={props.className} message="No draft to show." />;
  if (!q.data) {
    if (q.isError) {
      return (
        <ComposerShell inline={inline} className={props.className} tone="risk" message={`This draft couldn't load: ${q.error.message}`}>
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </ComposerShell>
      );
    }
    return <ComposerSkeleton inline={inline} className={props.className} />;
  }
  return <ComposerBody key={id} {...props} initial={q.data} server={q.data} />;
}

function ComposerShell({ inline, className, message, tone, children }: { inline?: boolean; className?: string; message: string; tone?: 'risk'; children?: React.ReactNode }) {
  return (
    <section className={cx('flex items-center gap-3 rounded-lg border border-line bg-surface px-4', inline ? 'h-16' : 'h-40', className)}>
      <Icon name={tone === 'risk' ? 'error' : 'info'} size="sm" className={tone === 'risk' ? 'text-danger-700' : 'text-muted'} />
      <p className={cx('text-body', tone === 'risk' ? 'text-danger-700' : 'text-muted')}>{message}</p>
      {children}
    </section>
  );
}

export function ComposerSkeleton({ inline, className }: { inline?: boolean; className?: string }) {
  return (
    <section aria-busy aria-label="Loading draft" className={cx('rounded-lg border border-line bg-surface', className)}>
      <div className={cx('flex items-center gap-2 border-b border-line px-3', inline ? 'h-10' : 'h-11')}>
        <span className="h-7 w-48 animate-pulse rounded-md bg-surface-sunken" />
        <span className="ml-auto h-4 w-20 animate-pulse rounded-sm bg-surface-sunken" />
      </div>
      <div className="space-y-2 px-4 py-4">
        <span className="block h-3 w-3/4 animate-pulse rounded-sm bg-surface-sunken" />
        <span className="block h-3 w-2/3 animate-pulse rounded-sm bg-surface-sunken" />
        <span className="block h-3 w-1/2 animate-pulse rounded-sm bg-surface-sunken" />
      </div>
      <div className="flex h-12 items-center justify-end gap-2 border-t border-line px-3">
        <span className="h-8 w-28 animate-pulse rounded-md bg-surface-sunken" />
      </div>
    </section>
  );
}

function placeholderFor(d: Destination): string {
  if (d.kind === 'slack') {
    if (d.threadTs) return 'Reply in thread…';
    if (d.target === 'dm') return `Message ${d.channelName.replace(/^@/, '')}`;
    return `Message ${d.channelName}`;
  }
  return d.target === 'new' ? 'Write your email…' : 'Write your reply…';
}

function fmtClock(tz: string | undefined, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(at);
  } catch {
    return 'now';
  }
}

function ComposerBody(props: ComposerProps & { initial: Draft; server: Draft }) {
  const { initial, server, variant = 'full', readOnly = false, people: peopleProp, destinations: extraDestinations, className, onExpand } = props;
  const inline = variant === 'inline';
  const external = props.primaryPlacement === 'external';
  const qc = useQueryClient();
  const id = initial.id;
  const draftKey = useMemo(() => queryKey('getDraft', { params: { id } }), [id]);

  // ---- data ----------------------------------------------------------------
  const settingsQ = useApi('getSettings');
  const sending = settingsQ.data?.sending;
  const dryRun = sending?.dryRun ?? true; // unknown = safest assumption
  const undoSec = sending?.undoWindowSec ?? 10;
  const tz = settingsQ.data?.profile.timezone;
  const senderName = settingsQ.data?.profile.name ?? 'You';
  const senderEmail = settingsQ.data?.profile.email;
  const workItemId = initial.workItemId ?? '';
  const nbaQ = useApi('getItemNba', { params: { id: workItemId } }, { enabled: !!workItemId });
  const itemQ = useApi('getItem', { params: { id: workItemId } }, { enabled: !!workItemId && !inline });
  const initiativeId = itemQ.data?.item.initiativeId ?? '';
  const initQ = useApi('getInitiative', { params: { id: initiativeId } }, { enabled: !!initiativeId });

  const people = useMemo<PersonLike[]>(() => {
    const all: PersonLike[] = [...(peopleProp ?? []), ...(initQ.data?.people ?? []), ...(itemQ.data?.item.people ?? []), ...threadPeople(initial.threadContext)];
    const seen = new Map<string, PersonLike>();
    for (const p of all) {
      const prev = seen.get(p.id);
      seen.set(p.id, prev ? { ...p, ...prev, email: prev.email ?? p.email, slackHandle: prev.slackHandle ?? p.slackHandle } : p);
    }
    return [...seen.values()];
  }, [peopleProp, initQ.data, itemQ.data, initial.threadContext]);

  // ---- editor (created once; live values flow through refs) ------------------
  const editorRef = useRef<Editor | null>(null);
  const ctx = useRef<ComposerEditorContext>({ profile: profileFor(initial.destination, initial.doc), placeholder: placeholderFor(initial.destination), mentionItems: () => [] });

  // ---- autosave ------------------------------------------------------------
  const [autosave] = useState(() => new DraftAutosave(initial, {} as never));
  autosave.setDeps({
    patch: (body) => api('patchDraft', { params: { id }, body }),
    onOptimistic: (d) => qc.setQueryData(draftKey, d),
    onSaved: (d) => {
      qc.setQueryData(draftKey, d);
      void qc.invalidateQueries({ queryKey: ['outbox'] });
      props.onSaved?.(d);
    },
    onRollback: (d) => qc.setQueryData(draftKey, d),
    onAdopt: (d) => {
      editorRef.current?.commands.setContent(d.doc, { emitUpdate: false });
    },
  });
  const save = useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState);
  const local = autosave.getLocal();
  useEffect(() => autosave.remote(server), [autosave, server]);

  // ---- send flow -----------------------------------------------------------
  // Draft ↔ Send: a mode the user set on this draft wins; otherwise the per-channel default from
  // Settings → Sending (BE-OUTBOX `channels.slack|gmail.mode`, default `draft`). The mode confirmed is the
  // one that runs; global dry-run still overrides both (shown next to the toggle).
  const lockedMode = initial.userLockedFields.includes('mode');
  const [modeChoice, setModeChoice] = useState<DispatchMode | null>(lockedMode ? initial.mode : null);
  const channelDefault = sending?.channels?.[local.destination.kind === 'slack' ? 'slack' : 'gmail']?.mode;
  const mode: DispatchMode = modeChoice ?? channelDefault ?? 'draft';
  const [flow] = useState(() => new SendFlow({} as never, mode));
  flow.setDeps({
    flush: () => autosave.flush(),
    preview: (m) => api('previewDraft', { params: { id }, body: { mode: m } }),
    dispatch: (req) => api('dispatchDraft', { params: { id }, body: req }),
    undoMs: () => undoSec * 1000,
  });
  const fs = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);
  const handled = useRef<SendState | null>(null);
  useEffect(() => {
    props.onSendStateChange?.(fs);
    if (fs.phase !== 'done' || handled.current === fs) return;
    handled.current = fs;
    if (fs.result) {
      qc.setQueryData(draftKey, fs.result.draft);
      autosave.remote(fs.result.draft);
    }
    void qc.invalidateQueries({ queryKey: ['outbox'] });
    props.onDispatched?.(fs.result, fs.outcome ?? 'dry_run');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs]);

  // Leaving mid-countdown cancels: nothing leaves unless the undo window runs out while you're here.
  useEffect(() => () => flow.undo(), [flow]);

  // ---- derived -------------------------------------------------------------
  const destination = local.destination;
  const isFinal = FINAL_STATUSES.includes(server.status);
  // A structured action (a VDP field change…) is read-only: approve or reject it, never edit it.
  const isAction = destination.kind === 'action';
  const editable = !readOnly && !isFinal && !flow.locked && !isAction;
  const profile = useMemo(() => profileFor(destination, local.doc), [destination, local.doc]);
  const serialized = useMemo(() => serialize(local.doc, toComposeDestination(destination)), [local.doc, destination]);
  const isEmpty = !String((serialized.payload as { text?: string }).text ?? '').trim();
  const labels = useMemo(() => mentionLabels(local.doc, people), [local.doc, people]);
  const channel = channelName(destination);
  const nba = nbaQ.data?.nba ?? null;
  const proposals: Proposal[] = (nbaQ.data?.proposals ?? []).filter((p) => p.status === 'pending' && p.entity.type === 'draft' && p.entity.id === id);
  const touched = save.touched;

  ctx.current = {
    profile,
    placeholder: placeholderFor(destination),
    mentionItems: (query) => mentionCandidates(destination, people, query),
  };

  const extensions = useMemo(() => composerExtensions(ctx), []);
  const editor = useEditor({
    extensions,
    content: initial.doc,
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: e }) => autosave.edit({ doc: e.getJSON() as TipTapDoc }),
    onBlur: () => void autosave.flush(),
    editorProps: { attributes: { class: cx(EDITOR_PROSE, inline ? 'min-h-10' : 'min-h-24'), 'aria-label': 'Message', 'aria-multiline': 'true', 'data-testid': 'composer-editor' } },
  });
  editorRef.current = editor;
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);
  useEffect(() => {
    if (editor && props.autoFocus) editor.commands.focus('end');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Save on navigation / tab close (keepalive so the request survives the page).
  useEffect(() => {
    const onHide = () => {
      const body = autosave.pendingBody();
      if (!body) return;
      void fetch(urlFor('patchDraft', { params: { id } }), { method: 'PATCH', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') void autosave.flush();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
      void autosave.flush();
    };
  }, [autosave, id]);

  // ---- UI state ------------------------------------------------------------
  const [showPreview, setShowPreview] = useState(props.defaultPreview ?? (readOnly || isFinal));
  const [showPayload, setShowPayload] = useState(props.defaultShowPayload ?? false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [rewrite, setRewrite] = useState<{ pending: RewriteInstruction | null; error: string | null; last: RewriteInstruction | null }>({ pending: null, error: null, last: null });
  const [pBusy, setPBusy] = useState<{ id: string; kind: 'apply' | 'reject' } | null>(null);
  const [pError, setPError] = useState<string | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);

  const candidates = useMemo(
    () => switchCandidates(destination, people.filter((p) => p.email || p.slackHandle), extraDestinations ?? [], itemQ.data?.item.title ?? '').slice(0, 7),
    [destination, people, extraDestinations, itemQ.data],
  );
  const options = useMemo(
    () => switchOptions(destination, local.doc, switchOpen ? candidates : candidates.slice(0, 1), people),
    [switchOpen, destination, local.doc, candidates, people],
  );

  // ---- actions -------------------------------------------------------------
  const canSend = !readOnly && !isFinal && !flow.locked && !isEmpty && save.status !== 'conflict' && !!editor;
  const primary = useCallback(() => {
    if (!canSend) return;
    void flow.open(mode);
  }, [canSend, flow, mode]);

  const setMode = (m: DispatchMode) => {
    setModeChoice(m);
    autosave.edit({ mode: m });
  };

  const doRewrite = async (instruction: RewriteInstruction) => {
    if (!nba) return;
    setRewrite({ pending: instruction, error: null, last: instruction });
    try {
      await autosave.flush();
      await api('regenerateNba', { params: { id: nba.id }, body: { ifVersion: nba.version, instruction } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['draft'] }), qc.invalidateQueries({ queryKey: ['nba'] })]);
      setRewrite({ pending: null, error: null, last: instruction });
    } catch (err) {
      const e = err as ApiError;
      void qc.invalidateQueries({ queryKey: ['nba'] });
      setRewrite({ pending: null, error: e.code === 'conflict' ? 'The suggestion changed meanwhile' : "Couldn't rewrite", last: instruction });
    }
  };

  const resolveProposal = async (p: Proposal, kind: 'apply' | 'reject') => {
    setPBusy({ id: p.id, kind });
    setPError(null);
    try {
      if (kind === 'apply') await autosave.flush();
      await api(kind === 'apply' ? 'applyProposal' : 'rejectProposal', { params: { id: p.id } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['draft'] }), qc.invalidateQueries({ queryKey: ['nba'] })]);
    } catch (err) {
      setPError(`Couldn't ${kind === 'apply' ? 'apply' : 'dismiss'} it: ${(err as Error).message}`);
    } finally {
      setPBusy(null);
    }
  };

  const switchTo = (d: Destination, doc: DocNode) => {
    const next = doc as TipTapDoc;
    if (docKey(next) !== docKey(local.doc)) editor?.commands.setContent(next, { emitUpdate: false });
    autosave.edit({ destination: d, doc: next });
    editor?.commands.focus();
  };

  useImperativeHandle(
    props.ref,
    () => ({
      focus: () => editor?.commands.focus('end'),
      appendText: (text: string) => {
        if (!editor || !editor.isEditable) return;
        // A new last paragraph, without moving focus (no scroll jump).
        editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text }] });
      },
      flush: () => autosave.flush(),
      send: primary,
      undo: () => flow.undo(),
      getDoc: () => (editor ? (editor.getJSON() as TipTapDoc) : null),
    }),
    [editor, autosave, primary, flow],
  );

  const dialogOpen = fs.phase === 'previewing' || fs.phase === 'confirming';

  const escClosesPopup = useRef(false);
  const onKeyDownCapture = (e: KeyboardEvent<HTMLElement>) => {
    if (dialogOpen) return; // the dialog owns its keys (⌘↵ confirms there)
    // Seen before ProseMirror closes the mention list, so the same Esc doesn't also blur.
    if (e.key === 'Escape') escClosesPopup.current = !!document.querySelector('[role="listbox"][aria-label="Mention someone"]');
    const mod = e.metaKey || e.ctrlKey;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && e.key === 'Enter') {
      stop();
      primary();
    } else if (e.altKey && !mod && e.code === 'KeyP') {
      stop();
      setShowPreview((v) => !v);
    } else if (mod && e.shiftKey && e.code === 'KeyC') {
      stop();
      if (!readOnly && !isFinal && !flow.locked) setSwitchOpen(true);
    } else if (mod && !e.shiftKey && e.key === '/') {
      stop();
      if (showPreview) setShowPreview(false);
      requestAnimationFrame(() => chipRef.current?.focus());
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && fs.phase === 'countdown') {
      stop();
      flow.undo();
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // ProseMirror marks every Escape as handled, so defaultPrevented can't tell us whether a popup consumed it.
    if (e.key !== 'Escape' || switchOpen || escClosesPopup.current) return;
    editor?.commands.blur();
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  // ---- render --------------------------------------------------------------
  const warnings = serialized.warnings.filter((w) => w.code === 'broadcast_mention');
  const parity = fs.preview ? previewParity(local.doc, destination, fs.preview, labels) : null;
  // a structured action (a logging canvas, a VDP change) is applied, not sent: the same verb as its confirm dialog
  const primaryLabel = isAction ? 'Apply' : mode === 'draft' ? 'Push as draft' : 'Send';
  const blockedReason =
    fs.phase === 'previewing' || canSend ? null : save.status === 'conflict' ? 'Choose “Keep yours” or “Take theirs” first' : isEmpty ? 'Write something first' : null;
  const where = destinationShort(destination);
  const countdownLabel = isAction ? `Applying ${where}` : mode === 'draft' ? `Pushing ${channel} draft to ${where}` : `Sending to ${where}`;
  const conflict = save.conflict;
  const fresh = nba?.update && nba.update.kind === 'revised' && !touched ? nba.update : null;
  const showChrome = !inline;
  const busyLabel = fs.phase === 'dispatching' ? (dryRun ? 'Rendering…' : isAction ? 'Applying…' : mode === 'draft' ? `Pushing to ${channel}…` : `Sending to ${channel}…`) : null;
  const countdown = fs.phase === 'countdown' && fs.deadline ? { deadline: fs.deadline, durationMs: fs.undoMs, label: countdownLabel, dryRun } : null;
  const hidden = readOnly || isFinal;
  const onPrimaryChange = props.onPrimaryChange;
  const primaryKey = JSON.stringify([primaryLabel, mode, !canSend, fs.phase === 'previewing', blockedReason, countdown?.deadline ?? null, countdownLabel, busyLabel, hidden, dryRun]);
  useEffect(() => {
    if (!external || !onPrimaryChange) return;
    onPrimaryChange({ label: primaryLabel, icon: mode === 'send' ? 'send' : 'edit', disabled: !canSend, loading: fs.phase === 'previewing', blockedReason, mode, countdown, busyLabel, hidden });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external, onPrimaryChange, primaryKey]);

  return (
    <section
      ref={root}
      aria-label={`Composer: ${destinationLabel(destination)}`}
      data-testid="composer"
      data-draft-id={id}
      data-phase={fs.phase}
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={onKeyDown}
      className={cx('@container flex min-w-0 flex-col rounded-lg border border-line bg-surface', className)}
    >
      {/* header: where it goes (a neutral label) · dry run · save status */}
      <header className={cx('flex min-w-0 items-center gap-2 border-b border-line', inline ? 'px-3 py-1.5' : 'px-4 py-2')}>
        <DestinationChip
          destination={destination}
          options={options}
          open={switchOpen}
          onOpenChange={setSwitchOpen}
          onSwitch={switchTo}
          disabled={readOnly || isFinal || flow.locked}
          compact={inline}
        />
        {warnings.map((w) => (
          <StatePill key={w.message} tone="warn" icon="warning" title={w.message} label={`${w.message.split(' ')[0]} notifies everyone`} />
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Dry run shows beside the Draft/Send toggle (it overrides both) and in the trust line. */}
          {readOnly ? (
            <StatePill tone="neutral" icon="preview" label="Read only" />
          ) : (
            <InlineStatus
              state={save.status === 'idle' ? (touched ? 'saved' : 'idle') : save.status}
              savedAt={save.savedLocalAt ?? server.savedAt ?? server.updatedAt}
              onRetry={() => void autosave.retry()}
            />
          )}
        </div>
      </header>

      {showChrome && initial.threadContext.length ? (
        <ThreadContext
          messages={initial.threadContext}
          channelLabel={destination.kind === 'slack' ? destination.channelName : destination.kind === 'action' ? destination.target.label : destination.subject}
          timezone={tz}
          format={destination.kind === 'email' ? 'plain' : 'slack_mrkdwn'}
          labels={labels}
        />
      ) : null}

      {!showPreview && editable && inline ? (
        <div className="flex flex-wrap items-center border-b border-line">
          <Toolbar editor={editor} profile={profile} compact channelLabel={channel} />
          {nba ? (
            <div className="border-l border-line">
              <AiChips
                pending={rewrite.pending}
                onRewrite={(i) => void doRewrite(i)}
                disabled={flow.locked}
                error={rewrite.error}
                onRetry={rewrite.last ? () => void doRewrite(rewrite.last!) : undefined}
                firstRef={chipRef}
                compact
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {!showPreview && editable && !inline ? (
        <div className="border-b border-line">
          <Toolbar
            editor={editor}
            profile={profile}
            compact={inline}
            channelLabel={channel}
            formatLabel={profile.id === 'slack_blocks' ? 'Slack rich text' : profile.id === 'slack_mrkdwn' ? 'Slack mrkdwn' : 'Email HTML'}
          />
          <div className="border-t border-line">
            <AiChips
              pending={rewrite.pending}
              onRewrite={(i) => void doRewrite(i)}
              disabled={!nba || flow.locked}
              disabledReason={!nba ? 'No next best action is linked to this draft' : undefined}
              error={rewrite.error}
              onRetry={rewrite.last ? () => void doRewrite(rewrite.last!) : undefined}
              firstRef={chipRef}
              compact={inline}
            />
          </div>
        </div>
      ) : null}

      <div className={cx('flex min-w-0 flex-col gap-3', inline ? 'px-3 py-3' : 'px-4 py-4')}>
        {conflict ? (
          <ConflictBanner
            diff={lineChanges(plainOf(conflict.doc, destination), plainOf(local.doc, destination))}
            busy={conflictBusy}
            onKeepMine={async () => {
              setConflictBusy(true);
              await autosave.keepMine();
              setConflictBusy(false);
            }}
            onTakeTheirs={() => autosave.takeTheirs()}
          />
        ) : null}

        {proposals.map((p) => (
          <DraftProposal
            key={p.id}
            proposal={p}
            busy={pBusy?.id === p.id ? pBusy.kind : null}
            error={pError}
            stale={docKey((p.changes.find((c) => c.field === 'doc')?.before as TipTapDoc | undefined) ?? local.doc) !== docKey(local.doc)}
            onApply={() => void resolveProposal(p, 'apply')}
            onKeepMine={() => void resolveProposal(p, 'reject')}
          />
        ))}

        {fresh && !showPreview ? (
          <p className="flex items-center gap-1.5 text-caption text-muted">
            <Icon name="sync" size="xs" />
            Updated {fmtClock(tz, new Date(fresh.at))}: {fresh.reason}
          </p>
        ) : null}

        {showPreview ? (
          <RecipientPreview doc={local.doc} destination={destination} labels={labels} senderName={senderName} senderEmail={senderEmail} timeLabel={fmtClock(tz)} />
        ) : destination.kind === 'action' && destination.action === 'slack_canvas.create' ? (
          // 2026-11-13 (B2): a canvas is reviewed row by row (see, search, remove, edit), not read as raw markdown
          <div className="space-y-4">
            <ActionPreview destination={destination} hideText />
            <CanvasReview draft={server} />
          </div>
        ) : destination.kind === 'action' ? (
          <ActionPreview destination={destination} />
        ) : (
          <div
            className={cx('rounded-md px-4 py-3 transition-colors', !editable ? 'border border-line bg-surface-muted' : touched ? 'border border-line bg-surface-input' : 'border-agentic')}
            onClick={() => editable && editor?.commands.focus()}
          >
            <p className={cx('mb-2 flex items-center gap-1.5 text-caption font-bold', touched ? 'text-muted' : 'text-ai-700')}>
              <Icon name={touched ? 'edit' : 'sparkles'} size="xs" />
              {touched ? `Edited by you · ${channel}` : `Drafted for you · ${channel}`}
            </p>
            <EditorContent editor={editor} />
          </div>
        )}

        {showPayload ? <PayloadPanel view={payloadView(local.doc, destination)} caption="From payloadFor" /> : null}

        {!readOnly && !isFinal ? (
          <p className="max-w-[68ch] text-caption text-muted" data-trust-line>
            Nothing sends until you approve it: every send is confirmed, then recorded in the Outbox.{dryRun ? ' Dry run is on, so nothing leaves this machine.' : ''}
          </p>
        ) : null}
      </div>

      <SendStatus state={fs} draft={server} channel={channel} inline={inline} onRetry={() => void flow.retry()} onDismiss={() => flow.reset()} />

      <footer className={cx('flex min-w-0 flex-wrap items-center gap-2 border-t border-line', inline ? 'px-3 py-2' : 'px-4 py-2.5')}>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={showPreview}
          onClick={() => setShowPreview((v) => !v)}
          kbd={inline ? undefined : 'alt+p'}
          className={cx(showPreview && 'bg-selected')}
          data-testid="toggle-preview"
        >
          <Icon name="preview" size="xs" />
          {inline ? 'Preview' : 'Preview as recipient'}
        </Button>
        {!inline ? (
          <Button size="sm" variant="ghost" aria-pressed={showPayload} onClick={() => setShowPayload((v) => !v)} className={cx(showPayload && 'bg-selected')} data-testid="toggle-payload">
            <Icon name="insert_tag_field" size="xs" />
            View payload
          </Button>
        ) : onExpand ? (
          <Button size="sm" variant="ghost" onClick={onExpand}>
            <Icon name="expand_alt" size="xs" />
            Open
          </Button>
        ) : null}

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {external && (fs.phase === 'countdown' || fs.phase === 'dispatching') ? null : fs.phase === 'countdown' && fs.deadline ? (
            <SendCountdownToast deadline={fs.deadline} durationMs={fs.undoMs} label={countdownLabel} dryRun={dryRun} onUndo={() => flow.undo()} className="min-w-72" />
          ) : fs.phase === 'dispatching' ? (
            <span role="status" className="inline-flex h-8 items-center gap-2 rounded-md bg-surface-muted px-3 text-body text-muted">
              <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
              {busyLabel}
            </span>
          ) : readOnly || isFinal ? null : (
            <>
              {dryRun ? (
                // Dry run overrides either mode: say so where the mode is chosen.
                <span className="inline-flex items-center gap-1 text-caption font-bold text-muted" data-dry-run-note title="Global dry run is on: Draft and Send both render the payload only.">
                  <Icon name="lock" size="xs" />
                  Dry run
                </span>
              ) : null}
              <Tooltip
                content={
                  (mode === 'draft' ? `Draft: creates a ${channel} draft; you press send there` : `Send: posts in ${channel} after you confirm`) +
                  (dryRun ? '. Dry run is on, so nothing leaves this machine.' : '') +
                  (!lockedMode && !modeChoice ? ` Default for ${channel} from Settings → Sending.` : '')
                }
              >
                <span className="inline-flex">
                  <SegmentedToggle<DispatchMode>
                    label="Push as a draft or send"
                    size="xs"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'draft', label: 'Draft', disabled: flow.locked },
                      { value: 'send', label: 'Send', disabled: flow.locked },
                    ]}
                  />
                </span>
              </Tooltip>
              {external ? null : (
                <Tooltip content={blockedReason} align="end">
                  <Button variant="primary" kbd="mod+enter" onClick={primary} disabled={!canSend} loading={fs.phase === 'previewing'} data-testid="composer-primary">
                    <Icon name={mode === 'send' ? 'send' : 'edit'} size="sm" />
                    {primaryLabel}
                  </Button>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </footer>

      <ConfirmSendDialog
        open={dialogOpen}
        mode={fs.mode}
        destination={fs.preview?.destination ?? destination}
        preview={fs.preview}
        loading={fs.phase === 'previewing'}
        dryRun={fs.preview?.dryRun ?? dryRun}
        undoSec={undoSec}
        warnings={warnings}
        parity={parity}
        labels={labels}
        senderName={senderName}
        senderEmail={senderEmail}
        onConfirm={() => flow.confirm()}
        onCancel={() => flow.cancel()}
      />
    </section>
  );
}

function plainOf(doc: TipTapDoc, d: Destination): string {
  return String((serialize(doc, toComposeDestination(d)).payload as { text?: string }).text ?? '');
}

/** The persistent outcome line next to the footer actions (UI-SPEC §9: anything needing action persists). */
function SendStatus(props: { state: SendState; draft: Draft; channel: string; inline?: boolean; onRetry: () => void; onDismiss: () => void }) {
  const body = sendStatusBody(props);
  if (!body) return null;
  return (
    <div
      data-tone={body.tone}
      className={cx(
        'flex min-w-0 items-center border-t border-line',
        props.inline ? 'px-2.5 py-1' : 'px-3 py-1.5',
        body.tone === 'risk' ? 'bg-danger-50' : body.tone === 'warn' ? 'bg-warning-50' : body.tone === 'ok' ? 'bg-success-50' : 'bg-surface-muted',
      )}
    >
      {body.node}
    </div>
  );
}

function sendStatusBody({ state, draft, channel, onRetry, onDismiss }: { state: SendState; draft: Draft; channel: string; onRetry: () => void; onDismiss: () => void }): { tone: 'risk' | 'warn' | 'ok' | 'neutral'; node: React.ReactNode } | null {
  if (state.phase === 'error' && state.error) {
    const e = state.error;
    const msg =
      e.stage === 'save'
        ? e.message
        : e.stage === 'preview'
          ? `Couldn't prepare the preview: ${e.message}`
          : e.code === 'upstream_unavailable'
            ? isAdminDraft(draft)
              ? `Couldn't apply it in ${channel}: ${e.message}. Nothing changed; it waits on Activity to Apply again.`
              : `Couldn't deliver to ${channel}: ${e.message}. Nothing was sent; it waits in the Outbox under Failed.`
            : e.message;
    // A failed dispatch is retried through a fresh preview + confirm (single-use confirm tokens, BE-OUTBOX).
    const retryLabel = e.stage === 'dispatch' ? 'Review and confirm again' : 'Retry';
    return { tone: 'risk', node: (
      <span role="alert" data-testid="send-status" data-outcome="error" data-reconfirm={e.stage === 'dispatch' || undefined} className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-danger-700">
        <Icon name="error" size="xs" />
        <span className="min-w-0">{msg}</span>
        <button type="button" onClick={onRetry} data-testid="send-retry" className="shrink-0 font-bold hover:underline focus-visible:shadow-focus focus-visible:outline-none">
          {retryLabel}
        </button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-muted hover:text-fg">
          <Icon name="close" size="xs" className="size-2.5" />
        </button>
      </span>
    ) };
  }
  if (state.phase === 'done' && state.outcome) {
    if (state.outcome === 'dry_run') {
      return { tone: 'warn', node: (
        <span role="status" data-testid="send-status" data-outcome="dry_run" className="inline-flex items-center gap-1.5 text-caption text-warning-700">
          <Icon name="lock" size="xs" />
          Dry run: payload rendered, nothing sent
        </span>
      ) };
    }
    const v = draft.verification;
    const verified = v?.state === 'verified';
    const action = draft.destination.kind === 'action';
    // an action (a canvas, a VDP change, the feedback post) is applied, and its result is one click away once it exists
    // a pushed draft waits in its app for you to send it: say where ("Pushed as Slack draft · find it in Slack ▸ Drafts")
    const head = action ? (draft.status === 'sending' ? 'Applying' : 'Applied') : state.outcome === 'staged' ? stagedLine(draft.destination, channel) : 'Sent';
    const tail = verified ? 'Verified ✓' : v?.state === 'pending' || !v ? 'Verifying…' : action ? 'Not verified' : 'Not verified · check Outbox';
    return { tone: verified ? 'ok' : 'neutral', node: (
      <span role="status" data-testid="send-status" data-outcome={state.outcome} className={cx('inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption', verified ? 'text-success-700' : 'text-muted')}>
        <Icon name={verified ? 'success' : 'send'} size="xs" />
        {head} · {tail}
        {draft.resultUrl ? <ResultLink href={draft.resultUrl} /> : null}
      </span>
    ) };
  }
  if (state.phase === 'idle' && state.undone) {
    return { tone: 'neutral', node: (
      <span role="status" data-testid="send-status" data-outcome="undone" className="inline-flex items-center gap-1.5 text-caption text-muted">
        <Icon name="undo" size="xs" />
        Undone. Nothing was sent.
      </span>
    ) };
  }
  if (['sent', 'verified', 'staged', ...(draft.destination.kind === 'action' ? ['sending', 'verify_failed'] : [])].includes(draft.status)) {
    const verified = draft.verification?.state === 'verified';
    const action = draft.destination.kind === 'action';
    return { tone: verified ? 'ok' : 'neutral', node: (
      <span data-testid="send-status" data-outcome={draft.status} className={cx('inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption', verified ? 'text-success-700' : 'text-muted')}>
        <Icon name={verified ? 'success' : 'send'} size="xs" />
        {action ? (draft.status === 'sending' ? 'Applying…' : 'Applied') : draft.status === 'staged' ? stagedLine(draft.destination, channel) : 'Sent'}
        {verified ? ' · Verified ✓' : action && draft.status === 'verify_failed' ? ' · Not verified' : ''}
        {draft.resultUrl ? <ResultLink href={draft.resultUrl} /> : null}
      </span>
    ) };
  }
  return null;
}

/** "Open ↗": where the applied or sent result lives (`Draft.resultUrl`). */
function ResultLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-testid="send-result-link" title={href} className="inline-flex items-center gap-1 font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
      · Open <Icon name="new_window" size="xs" />
    </a>
  );
}
