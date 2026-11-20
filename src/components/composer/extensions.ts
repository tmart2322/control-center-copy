'use client';
/**
 * TipTap setup for the composer: StarterKit + Link + Mention + Placeholder, plus a capability guard that
 * keeps formatting the destination can't render out of the document (input rules, shortcuts and paste).
 * Live values (destination, people, profile) come through a ref so the editor is created once.
 */
import { Extension, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import { ReactRenderer } from '@tiptap/react';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { RefObject } from 'react';
import type { CapabilityKey, CapabilityProfile } from '@/lib/compose';
import type { MentionCandidate } from './destination';
import { MentionList, type MentionListHandle, type MentionListProps } from './MentionList';

export interface ComposerEditorContext {
  profile: CapabilityProfile;
  placeholder: string;
  mentionItems: (query: string) => MentionCandidate[];
}

const NODE_CAP: Record<string, CapabilityKey> = {
  heading: 'heading',
  bulletList: 'bulletList',
  orderedList: 'orderedList',
  blockquote: 'blockquote',
  codeBlock: 'codeBlock',
  hardBreak: 'hardBreak',
  mention: 'mention',
};
const MARK_CAP: Record<string, CapabilityKey> = { bold: 'bold', italic: 'italic', strike: 'strike', code: 'code', link: 'link' };

/** How many nodes/marks in `doc` the profile can't render. */
export function countUnsupported(doc: PMNode, profile: CapabilityProfile): number {
  let n = 0;
  doc.descendants((node) => {
    const cap = NODE_CAP[node.type.name];
    if (cap && !profile.supports[cap]) n++;
    for (const m of node.marks) {
      const mc = MARK_CAP[m.type.name];
      if (mc && !profile.supports[mc]) n++;
    }
  });
  return n;
}

/** Pasted content: headings the destination can't render become bold paragraphs. */
function downgrade(frag: Fragment, schema: Schema, profile: CapabilityProfile): Fragment {
  const out: PMNode[] = [];
  frag.forEach((node) => {
    if (node.isText) {
      out.push(node);
      return;
    }
    if (node.type.name === 'heading' && !profile.supports.heading && schema.nodes.paragraph) {
      const bold = schema.marks.bold;
      const inner: PMNode[] = [];
      downgrade(node.content, schema, profile).forEach((c) => inner.push(c.isText && bold ? c.mark(bold.create().addToSet(c.marks)) : c));
      out.push(schema.nodes.paragraph.create(null, inner));
      return;
    }
    out.push(node.copy(downgrade(node.content, schema, profile)));
  });
  return Fragment.fromArray(out);
}

const guardKey = new PluginKey('ccCapabilityGuard');

function capabilityGuard(ctx: RefObject<ComposerEditorContext>) {
  return Extension.create({
    name: 'ccCapabilityGuard',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: guardKey,
          // Reject user transactions that add formatting this destination can't render (e.g. "# " in Slack).
          filterTransaction(tr, state) {
            if (!tr.docChanged || tr.getMeta('preventUpdate') || tr.getMeta('ccSystem')) return true;
            const profile = ctx.current?.profile;
            if (!profile) return true;
            return countUnsupported(tr.doc, profile) <= countUnsupported(state.doc, profile);
          },
          props: {
            transformPasted(slice, view) {
              const profile = ctx.current?.profile;
              if (!profile) return slice;
              return new Slice(downgrade(slice.content, view.state.schema, profile), slice.openStart, slice.openEnd);
            },
          },
        }),
      ];
    },
  });
}

/** Mention with `kind` and `email` attrs (the compose serializers read them), rendered as a pill. */
const ComposerMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: 'user',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-kind') ?? 'user',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-kind': attrs.kind }),
      },
      email: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-email'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.email ? { 'data-email': attrs.email } : {}),
      },
    };
  },
});

export function composerExtensions(ctx: RefObject<ComposerEditorContext>): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      horizontalRule: false,
      underline: false,
      link: false,
      trailingNode: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: 'https',
      protocols: ['mailto'],
      isAllowedUri: (url) => /^(https?:|mailto:)/i.test(url),
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
    }),
    ComposerMention.configure({
      HTMLAttributes: { class: 'cc-pill' },
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      renderHTML: ({ options, node }) => ['span', options.HTMLAttributes, `@${node.attrs.label ?? node.attrs.id}`],
      suggestion: {
        char: '@',
        items: ({ query }) => ctx.current?.mentionItems(query) ?? [],
        render: () => {
          let renderer: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
          let unmount: (() => void) | null = null;
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(MentionList, {
                props: { items: props.items as MentionCandidate[], command: props.command, query: props.query },
                editor: props.editor,
              });
              unmount = props.mount(renderer.element);
            },
            onUpdate: (props) => {
              renderer?.updateProps({ items: props.items as MentionCandidate[], command: props.command, query: props.query });
            },
            onKeyDown: (props) => (props.event.key === 'Escape' ? true : (renderer?.ref?.onKeyDown(props.event) ?? false)),
            onExit: () => {
              unmount?.();
              unmount = null;
              renderer?.destroy();
              renderer = null;
            },
          };
        },
      },
    }),
    Placeholder.configure({ placeholder: () => ctx.current?.placeholder ?? 'Write a message…' }),
    capabilityGuard(ctx),
  ];
}

/** Toolbar key → TipTap command and active check. */
export type ToolKey = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'bulletList' | 'orderedList' | 'blockquote' | 'codeBlock' | 'heading';
