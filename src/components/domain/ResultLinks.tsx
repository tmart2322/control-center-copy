'use client';
/**
 * Where an applied action's result lives, and the Slackbot prompt for a canvas: shared by Outbox ▸ Sent, the draft
 * panel and composer outcome, Time's receipts and Confirm step, and Time ▸ Forecast. "Open ↗" opens the result
 * (`Draft.resultUrl`: the canvas, the post, the VDP record) in a new tab; "Copy Slackbot prompt" copies the text the
 * user pastes to Slackbot. Nothing is sent from here.
 */
import { useMemo } from 'react';
import type { ActionDestination, Draft } from '@/contract';
import { usePersona } from '@/client/persona';
import { toast } from '@/client/toast';
import { loggingProfile } from '@/engines/activity/persona';
import { canvasPromptFor } from '@/lib/canvas/prompt';
import { copyText } from '@/components/time/shared';
import { cn, Icon } from '@/ui';

/** The persona's logging wording for a prompt: its record type (Solutions Event, Sales Events) and whether rows carry a task type. */
export function usePromptWording(): { recordTypeName: string; taskType: boolean; taskTypes: string[]; internal: boolean } {
  const persona = usePersona();
  // the type pickers offer the persona's task types (the SE's: the SE Task Type taxonomy, D-64)
  return useMemo(() => {
    const p = loggingProfile(persona);
    // D-64: whether the persona logs internal-only work (the SE's)
    return { recordTypeName: p.recordTypeName, taskType: p.taskTypeRequired, taskTypes: p.taskTypes, internal: p.internalActivity };
  }, [persona]);
}

/** The Slackbot prompt of a canvas item (null: not a canvas). */
export function useCanvasPromptOf(): (d: Pick<Draft, 'destination' | 'resultUrl'>) => string | null {
  const w = usePromptWording();
  return (d) => (d.destination.kind === 'action' && d.destination.action === 'slack_canvas.create' ? canvasPromptFor(d.destination as ActionDestination, { url: d.resultUrl, ...w }) : null);
}

/** Copy a prompt and say so (a toast; nothing is sent). */
export async function copySlackbotPrompt(text: string, title: string): Promise<boolean> {
  const ok = await copyText(text);
  toast({
    key: 'slackbot-prompt',
    tone: ok ? 'success' : 'error',
    title: ok ? `Slackbot prompt copied: ${title}` : "Couldn't copy the prompt",
    body: ok ? 'Paste it to Slackbot yourself; it runs the work order in Org62. Nothing was sent from here.' : 'Open the canvas in Slack and tell Slackbot "Execute this canvas" instead.',
  });
  return ok;
}

/** "Open ↗": the result in a new tab. */
export function OpenResult({ href, label = 'Open', title, className, testId = 'result-link' }: { href: string; label?: string; title?: string; className?: string; testId?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title ?? href} data-testid={testId} className={cn('inline-flex shrink-0 items-center gap-1 font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none', className)}>
      {label}
      <Icon name="new_window" size="xs" />
    </a>
  );
}

/** "Copy Slackbot prompt" as a quiet text button. */
export function CopyPromptButton({ prompt, title, className, testId = 'copy-prompt', onCopied }: { prompt: string; title: string; className?: string; testId?: string; onCopied?: () => void }) {
  return (
    <button type="button" onClick={() => void copySlackbotPrompt(prompt, title).then((ok) => ok && onCopied?.())} data-testid={testId} className={cn('inline-flex shrink-0 items-center gap-1 font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none', className)}>
      <Icon name="copy" size="xs" />
      Copy Slackbot prompt
    </button>
  );
}
