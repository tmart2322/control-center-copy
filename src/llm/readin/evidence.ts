/**
 * D2 (audit 2026-11-13): the evidence hash of a read-in's context pack. Two context packs with the same evidence hash
 * would research the same thing, so an automatic read-in whose hash matches the last ready one is not run again
 * (llm_decisions: skip `evidence_unchanged`).
 *
 * The hash covers what the agent researches from: the item or meeting, its evidence, what I said before, related
 * items, the account / opp / initiative, and the reply target. It leaves out what moves without new evidence: the
 * clock (`now`), the trigger, the generation counter, and the ranking (rank and its `why` text).
 */
import { ledgerHash } from '@/db/ledger';

import type { ContextItemRef, ReadInContext } from './types';

const ref = (r: ContextItemRef) => ({ id: r.id, title: r.title, kind: r.kind, state: r.state, due: r.due, doneAt: r.doneAt ?? null });

export function readInEvidenceHash(c: ReadInContext, skillVersion: string | null = null): string {
  const item = c.item ? { ...c.item, rank: null, why: null } : null;
  const event = c.event ? { ...c.event, linkedItems: c.event.linkedItems.map(ref) } : null;
  return ledgerHash(
    'readin-evidence/v1',
    skillVersion,
    c.skill,
    JSON.stringify({
      entity: c.entity,
      me: c.me,
      item,
      event,
      account: c.account ?? null,
      opp: c.opp ?? null,
      initiative: c.initiative ?? null,
      evidence: c.evidence,
      siblings: c.siblings.map(ref),
      related: c.related.map(ref),
      saidBefore: c.saidBefore,
      reply: c.reply ?? null,
      voice: c.voice ?? null,
    }),
  );
}
