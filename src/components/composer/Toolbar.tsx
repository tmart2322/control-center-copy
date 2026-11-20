'use client';
/**
 * Capability-aware toolbar: formatting the destination can't render is disabled, with a tooltip saying why
 * (UI-SPEC §7). The link button opens an inline URL field instead of a browser prompt.
 */
import { useEditorState, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import type { CapabilityKey, CapabilityProfile } from '@/lib/compose';
import { Button, Icon } from '@/ui';
import { Tooltip, cx } from './_bits';
import type { ToolKey } from './extensions';

interface ToolDef {
  key: ToolKey;
  cap: CapabilityKey;
  icon: string;
  label: string;
  kbd?: string;
  noun: string;
}

const GROUPS: ToolDef[][] = [
  [
    { key: 'bold', cap: 'bold', icon: 'bold', label: 'Bold', kbd: '⌘B', noun: 'bold' },
    { key: 'italic', cap: 'italic', icon: 'italic', label: 'Italic', kbd: '⌘I', noun: 'italics' },
    { key: 'strike', cap: 'strike', icon: 'strikethrough', label: 'Strikethrough', kbd: '⌘⇧S', noun: 'strikethrough' },
    { key: 'code', cap: 'code', icon: 'insert_tag_field', label: 'Inline code', kbd: '⌘E', noun: 'inline code' },
    { key: 'link', cap: 'link', icon: 'link', label: 'Link', noun: 'links' },
  ],
  [
    { key: 'bulletList', cap: 'bulletList', icon: 'richtextbulletedlist', label: 'Bulleted list', kbd: '⌘⇧8', noun: 'bulleted lists' },
    { key: 'orderedList', cap: 'orderedList', icon: 'richtextnumberedlist', label: 'Numbered list', kbd: '⌘⇧7', noun: 'numbered lists' },
    { key: 'blockquote', cap: 'blockquote', icon: 'quotation_marks', label: 'Quote', kbd: '⌘⇧B', noun: 'quotes' },
    { key: 'codeBlock', cap: 'codeBlock', icon: 'apex', label: 'Code block', kbd: '⌘⌥C', noun: 'code blocks' },
  ],
  [{ key: 'heading', cap: 'heading', icon: 'text', label: 'Heading', kbd: '⌘⌥2', noun: 'headings' }],
];

export const COMPACT_TOOLS: ToolKey[] = ['bold', 'italic', 'link', 'bulletList', 'orderedList'];

function run(editor: Editor, key: ToolKey) {
  const c = editor.chain().focus();
  switch (key) {
    case 'bold':
      return c.toggleBold().run();
    case 'italic':
      return c.toggleItalic().run();
    case 'strike':
      return c.toggleStrike().run();
    case 'code':
      return c.toggleCode().run();
    case 'bulletList':
      return c.toggleBulletList().run();
    case 'orderedList':
      return c.toggleOrderedList().run();
    case 'blockquote':
      return c.toggleBlockquote().run();
    case 'codeBlock':
      return c.toggleCodeBlock().run();
    case 'heading':
      return c.toggleHeading({ level: 2 }).run();
    case 'link':
      return false;
  }
}

export interface ToolbarProps {
  editor: Editor | null;
  profile: CapabilityProfile;
  disabled?: boolean;
  compact?: boolean;
  /** Shown at the right: which format the payload uses. */
  formatLabel?: string;
  channelLabel: string;
}

export function Toolbar({ editor, profile, disabled, compact, formatLabel, channelLabel }: ToolbarProps) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return {} as Record<ToolKey, boolean>;
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        link: e.isActive('link'),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        blockquote: e.isActive('blockquote'),
        codeBlock: e.isActive('codeBlock'),
        heading: e.isActive('heading'),
      } as Record<ToolKey, boolean>;
    },
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (linkOpen) input.current?.focus();
  }, [linkOpen]);

  const groups = compact ? [GROUPS.flat().filter((t) => COMPACT_TOOLS.includes(t.key))] : GROUPS;

  const openLink = () => {
    if (!editor) return;
    setHref(String(editor.getAttributes('link').href ?? ''));
    setLinkOpen(true);
  };
  const applyLink = () => {
    if (!editor) return;
    const v = href.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!v) chain.unsetLink().run();
    else chain.setLink({ href: /^(https?:|mailto:)/i.test(v) ? v : `https://${v}` }).run();
    setLinkOpen(false);
  };

  return (
    <div role="toolbar" aria-label="Formatting" className="flex min-h-9 flex-wrap items-center gap-0.5 px-2 py-1">
      {groups.map((g, gi) => (
        <div key={gi} className={cx('flex items-center gap-0.5', gi > 0 && 'ml-1 border-l border-line pl-1')}>
          {g.map((t) => {
            const supported = profile.supports[t.cap];
            const isOn = !!active?.[t.key];
            const reason = supported ? `${t.label}${t.kbd ? ` · ${t.kbd}` : ''}` : `${channelLabel} can't render ${t.noun}`;
            return (
              <Tooltip key={t.key} content={reason} side="top">
                <button
                  type="button"
                  aria-label={t.label}
                  aria-pressed={supported ? isOn : undefined}
                  disabled={disabled || !supported || !editor}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (editor ? (t.key === 'link' ? openLink() : run(editor, t.key)) : undefined)}
                  data-unsupported={!supported || undefined}
                  className={cx(
                    'grid size-7 place-items-center rounded-md transition-colors duration-(--dur-quick) focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed',
                    // One class per property and state: pressed, resting and disabled never stack colors.
                    isOn && supported ? 'bg-selected text-fg-heading' : 'text-muted enabled:hover:bg-surface-muted enabled:hover:text-fg disabled:text-disabled',
                  )}
                >
                  <Icon name={t.icon} size="sm" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      ))}
      {linkOpen ? (
        <form
          className="ml-2 flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            ref={input}
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setLinkOpen(false);
                editor?.commands.focus();
              }
            }}
            placeholder="https://"
            aria-label="Link address"
            className="h-7 w-56 rounded-md border border-line-input bg-surface px-2 text-caption focus:border-focus focus:shadow-[0_0_0_1px_var(--color-focus)] focus:outline-none"
          />
          <Button size="sm" variant="secondary" type="submit">
            {href.trim() ? 'Apply' : 'Remove'}
          </Button>
        </form>
      ) : null}
      {formatLabel && !compact ? <span className="ml-auto pr-1 text-caption text-faint">{formatLabel}</span> : null}
    </div>
  );
}
