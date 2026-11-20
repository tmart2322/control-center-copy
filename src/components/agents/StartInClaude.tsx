'use client';
/**
 * Start in Claude (UI-SPEC §12). POST /agents/launch returns the claude://code/new URL plus the run record
 * (nothing opens yet). A confirm step then shows the repo folder and the first 20 lines of the context pack;
 * only the explicit "Open in Claude" click opens the URL.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiError } from '@/client/api';
import { useApi } from '@/client/hooks';
import { toast } from '@/client/toast';
import { Button, Dialog, Icon, Popover } from '@/ui';
import { openClaudeUrl, parseNewLink, promptPreview, rankTasks, shortPath } from './claude';

/** Folder + prompt preview, as the user is about to open it. */
export function LaunchPreview({ url }: { url: string }) {
  const parsed = useMemo(() => parseNewLink(url), [url]);
  const preview = useMemo(() => promptPreview(parsed?.prompt ?? '', 20), [parsed]);
  if (!parsed) return <p className="text-body text-muted">This link has no prompt to preview.</p>;
  return (
    <div className="flex flex-col gap-2" data-testid="launch-preview">
      <div>
        <p className="text-caption text-muted">Repo folder</p>
        <p className="font-mono text-caption text-fg" data-testid="launch-folder">
          {parsed.folder ? shortPath(parsed.folder) : 'Claude’s default folder'}
        </p>
      </div>
      <div>
        <p className="text-caption text-muted">Context pack · first {preview.lines.length} lines</p>
        <pre className="cc-scroll max-h-56 overflow-auto rounded-md bg-surface-muted p-2 font-mono text-caption whitespace-pre-wrap text-fg" data-testid="launch-prompt">
          {preview.lines.join('\n')}
        </pre>
        {preview.hidden ? <p className="mt-1 text-caption text-muted">+ {preview.hidden} more lines are sent with it.</p> : null}
      </div>
      <p className="flex items-start gap-1.5 text-caption text-muted">
        <Icon name="info" size="xs" className="mt-0.5 shrink-0" />
        Opens a new session in the Claude Desktop Code tab. You run it there; nothing is sent from here.
      </p>
    </div>
  );
}

/** Confirm opening a not-yet-started Claude session whose claude://code/new link we already have. */
export function StartConfirmDialog({ url, title, onClose }: { url: string | null; title?: string; onClose: () => void }) {
  return (
    <Dialog
      open={!!url}
      onClose={onClose}
      title={title ? `Start in Claude: ${title}` : 'Start in Claude'}
      width={560}
      confirmLabel="Open in Claude"
      onConfirm={() => {
        if (url && openClaudeUrl(url)) toast({ title: 'Opening in Claude', key: 'start-claude', durationMs: 3000 });
        onClose();
      }}
    >
      {url ? <LaunchPreview url={url} /> : null}
    </Dialog>
  );
}

/** Header action: pick (optionally) a task, prepare the launch, then confirm and open. */
export function StartInClaude({ variant = 'primary', open: openProp, onOpenChange }: { variant?: 'primary' | 'secondary'; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (o: boolean) => {
    setInnerOpen(o);
    onOpenChange?.(o);
  };
  const [workItemId, setWorkItemId] = useState('');
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<{ url: string; title: string } | null>(null);
  const items = useApi('listItems', { query: { tab: 'all_open' } }, { enabled: open });
  // 2026-11-13 audit C8: every open task, ranked, searchable (it stopped at the first 40)
  const [taskQ, setTaskQ] = useState('');
  const all = useMemo(() => items.data?.items ?? [], [items.data]);
  const tasks = useMemo(() => rankTasks(all, taskQ), [all, taskQ]);
  const picked = all.find((t) => t.id === workItemId);

  const reset = () => {
    setLaunched(null);
    setError(null);
    setWorkItemId('');
    setTitle('');
    setFolder('');
    setPrompt('');
    setTaskQ('');
  };

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api('launchAgent', {
        body: {
          ...(workItemId ? { workItemId } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(folder.trim() ? { folder: folder.trim() } : {}),
          ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        },
      });
      setLaunched({ url: res.url, title: res.run.title });
      void qc.invalidateQueries({ queryKey: ['agents'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = 'h-8 w-full rounded-md border border-line-input bg-surface px-2 text-body placeholder:text-faint focus:border-brand-600 focus:outline-none';
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
      placement="bottom-end"
      width={500}
      label="Start in Claude"
      trigger={
        <Button variant={variant} size="md" icon="agent_session" kbd="shift+s" data-testid="start-in-claude">
          Start in Claude
        </Button>
      }
    >
      {({ close }) =>
        launched ? (
          <div className="flex flex-col gap-3 p-3">
            <p className="text-body-lg font-bold text-fg-heading">Open “{launched.title}” in Claude?</p>
            <LaunchPreview url={launched.url} />
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-caption text-muted">Not now keeps it queued here.</span>
              <Button size="sm" variant="secondary" onClick={close}>
                Not now
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon="new_window"
                data-testid="confirm-open-claude"
                onClick={() => {
                  if (openClaudeUrl(launched.url)) toast({ title: 'Opening in Claude', key: 'start-claude', durationMs: 3000 });
                  close();
                }}
              >
                Open in Claude
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void prepare();
            }}
          >
            <p className="text-body-lg font-bold text-fg-heading">Start a Claude session</p>
            <label className="flex flex-col gap-0.5 text-caption text-muted">
              Task (its context pack becomes the prompt)
              <input value={taskQ} onChange={(e) => setTaskQ(e.target.value)} placeholder={`Search ${all.length} open tasks by title or account`} className={field} aria-label="Search tasks" data-testid="start-claude-task-search" />
              <select value={workItemId} onChange={(e) => setWorkItemId(e.target.value)} className={field} aria-label="Task">
                <option value="">No task, a blank session</option>
                {picked && !tasks.includes(picked) ? <option value={picked.id}>{picked.title}</option> : null}
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.rank ? `#${t.rank} · ` : ''}
                    {t.title}
                    {t.refs.account?.label ? ` · ${t.refs.account.label}` : ''}
                  </option>
                ))}
              </select>
              <span className="text-caption text-faint tabular-nums">{taskQ ? `${tasks.length} of ${all.length} tasks match` : `${all.length} open tasks, ranked`}</span>
            </label>
            <label className="flex flex-col gap-0.5 text-caption text-muted">
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the task title" className={field} />
            </label>
            <label className="flex flex-col gap-0.5 text-caption text-muted">
              Repo folder
              <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Default repo folder" className={`${field} font-mono`} />
            </label>
            <label className="flex flex-col gap-0.5 text-caption text-muted">
              Prompt (optional)
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Leave empty to use the task’s context pack" className="rounded-md border border-line-input bg-surface p-2 text-body placeholder:text-faint focus:border-brand-600 focus:outline-none" />
            </label>
            {error ? (
              <p role="alert" className="text-caption text-danger-700">
                Couldn’t prepare the session: {error}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-caption text-muted">Next: preview, then open.</span>
              <Button size="sm" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit" loading={busy}>
                Preview launch
              </Button>
            </div>
          </form>
        )
      }
    </Popover>
  );
}
