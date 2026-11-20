/**
 * Drive files → assets, and Gemini notes → meeting notes.
 *
 * Assets come from two places:
 *  - Drive revisions (`drive:<fileId>@<modifiedTime>`, payload: fileId, fileKind, lastModifyingUser, editedByMe);
 *  - Drive attachments on calendar invites (decks and docs shared for a meeting), Gemini notes excluded.
 * One asset per Drive file id; the newest revision wins for title, modifier and modified time.
 *
 * Gemini notes (`gemini:<docId>`, payload: eventId, myNextSteps, othersNextSteps) become meeting_notes rows tied
 * to their calendar event; the event's takeaways chip counts the work items the scanner opened from them.
 */
import type { ProjectedAsset, ProjectedEvent, ProjectedNote, SourceRow } from './types';
import { arr, bool, obj, str } from './util';

const KIND: Record<string, ProjectedAsset['kind']> = { slides: 'deck', doc: 'doc', sheet: 'sheet', pdf: 'pdf' };

export function kindFromMime(mime: string | null | undefined): ProjectedAsset['kind'] {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('presentation')) return 'deck';
  if (m.includes('spreadsheet')) return 'sheet';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('document') || m.includes('word')) return 'doc';
  return 'other';
}

export function driveUrl(fileId: string, kind: ProjectedAsset['kind']): string {
  if (kind === 'deck') return `https://docs.google.com/presentation/d/${fileId}/edit`;
  if (kind === 'doc') return `https://docs.google.com/document/d/${fileId}/edit`;
  if (kind === 'sheet') return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export interface DriveEdit {
  fileId: string;
  title: string;
  at: string;
  byMe: boolean;
  sourceItemId: string;
}

/** A Drive revision item → the edit it records (null for rows that are not the fetcher's). */
export function driveEdit(si: SourceRow): DriveEdit | null {
  if (si.source !== 'drive' || si.deletedUpstreamAt) return null;
  const fileId = str(si.meta.fileId) ?? (si.dedupeKey.startsWith('drive:') ? si.externalId.split('@')[0] ?? null : null);
  if (!fileId) return null;
  const at = str(si.meta.modifiedTime) ?? si.occurredAt;
  const user = obj(si.meta.lastModifyingUser);
  const byMe = bool(si.meta.editedByMe) === true || si.fromMe || bool(user?.isMe) === true;
  return { fileId, title: si.title ?? fileId, at, byMe, sourceItemId: si.id };
}

export function assetsFromDrive(items: SourceRow[]): ProjectedAsset[] {
  const out = new Map<string, ProjectedAsset>();
  for (const si of [...items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const e = driveEdit(si);
    if (!e) continue;
    const kind = KIND[str(si.meta.fileKind) ?? ''] ?? 'other';
    const user = obj(si.meta.lastModifyingUser);
    const prev = out.get(e.fileId);
    out.set(e.fileId, {
      externalId: e.fileId,
      kind: kind === 'other' && prev ? prev.kind : kind,
      title: e.title,
      url: si.url ?? driveUrl(e.fileId, kind),
      mimeType: prev?.mimeType ?? null,
      lastModifiedAt: e.at,
      lastModifiedByMe: e.byMe,
      lastModifierName: e.byMe ? null : str(user?.name),
      eventExternalId: prev?.eventExternalId ?? null,
      sourceItemIds: [...(prev?.sourceItemIds ?? []), si.id],
    });
  }
  return [...out.values()];
}

const GEMINI = /notes by gemini/i;

export function assetsFromEvents(events: ProjectedEvent[]): ProjectedAsset[] {
  const out: ProjectedAsset[] = [];
  for (const e of events) {
    for (const a of e.attachments) {
      if (!a.fileId || GEMINI.test(a.title) || a.fileId === e.geminiNotesDocId) continue;
      const kind = kindFromMime(a.mimeType);
      out.push({
        externalId: a.fileId,
        kind,
        title: a.title || a.fileId,
        url: driveUrl(a.fileId, kind),
        mimeType: a.mimeType,
        lastModifiedAt: null,
        lastModifiedByMe: false,
        lastModifierName: null,
        eventExternalId: e.externalEventId,
        sourceItemIds: [e.sourceItemId],
      });
    }
  }
  return out;
}

/** Drive revisions win over invite attachments (they know the modifier); attachments add the meeting link. */
export function mergeAssets(drive: ProjectedAsset[], fromEvents: ProjectedAsset[]): ProjectedAsset[] {
  const by = new Map<string, ProjectedAsset>();
  for (const a of fromEvents) if (!by.has(a.externalId)) by.set(a.externalId, a);
  for (const d of drive) {
    const ev = by.get(d.externalId);
    by.set(d.externalId, ev ? { ...d, mimeType: d.mimeType ?? ev.mimeType, eventExternalId: ev.eventExternalId, sourceItemIds: [...new Set([...ev.sourceItemIds, ...d.sourceItemIds])] } : d);
  }
  return [...by.values()].sort((a, b) => a.externalId.localeCompare(b.externalId));
}

export function projectGeminiNote(si: SourceRow): ProjectedNote | null {
  if (si.source !== 'gemini_notes' || si.deletedUpstreamAt) return null;
  const docId = str(si.meta.docId) ?? (si.dedupeKey.startsWith('gemini:') ? si.externalId : null);
  if (!docId) return null;
  const mine = arr(si.meta.myNextSteps).length;
  const others = arr(si.meta.othersNextSteps).length;
  const threadEvent = si.externalParentId?.startsWith('calendar:') ? si.externalParentId.slice('calendar:'.length) : null;
  return {
    sourceItemId: si.id,
    docExternalId: docId,
    url: si.url,
    eventExternalId: str(si.meta.eventId) ?? threadEvent,
    arrivedAt: si.occurredAt,
    nextStepCount: Math.min(32767, mine + others),
    myNextStepCount: Math.min(32767, mine),
  };
}
