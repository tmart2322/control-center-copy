/**
 * DLV-1: does my reply carry the thing the item asks for? "Send the repo folder" answered with "here you go" plus a zip
 * is a delivery; the same words without a file are only a pointer. The scanner only ever saw the text, so such replies
 * stayed Likely done (a confirm click), and a completion link already written was never judged again.
 *
 * Deterministic and pure: the item's title/purpose and the message's attachments (REC-1 records file names and types
 * from detailed reads, and `hasFile` from the scan's `has:file` search) and links. It matches when
 *  - an attachment or link is of the kind the title asks for (folder/zip for a repo or folder, slides for a deck, …),
 *  - or an attachment's name shares a distinctive word with the title,
 *  - or the title asks for a file of any kind ("send the file", "share it") and there is one.
 * A message with no attachment or link never matches.
 */

export interface DeliveryMessage {
  files?: { name?: string; mimetype?: string }[];
  /** Found by the `has:file` search: a file is attached, its name unknown. */
  hasFile?: boolean;
  /** Links in the text (Drive file refs and URLs). */
  urls?: string[];
}

type Kind = 'slides' | 'doc' | 'sheet' | 'archive' | 'folder' | 'image' | 'video' | 'pdf' | 'link' | 'any';

/** What the title asks for → the kinds that deliver it. */
const ASKED: Array<{ re: RegExp; kinds: Kind[] }> = [
  { re: /\b(deck|slides?|presentation|ppt|pptx)\b/i, kinds: ['slides', 'pdf', 'link'] },
  { re: /\b(doc|docs|document|notes|write-?up|pov|brief|summary|script|guide|readme|instructions)\b/i, kinds: ['doc', 'pdf', 'link'] },
  { re: /\b(sheet|spreadsheet|estimate|estimates|calculator|model|tco|csv|xlsx|numbers)\b/i, kinds: ['sheet', 'archive', 'link'] },
  { re: /\b(repo|repository|folder|code|package|zip|bundle|app|build|project files?)\b/i, kinds: ['archive', 'folder', 'link'] },
  { re: /\b(recording|video|demo video|walkthrough)\b/i, kinds: ['video', 'link'] },
  { re: /\b(screenshot|image|diagram|visual|picture|logo)\b/i, kinds: ['image', 'pdf', 'slides', 'link'] },
  { re: /\b(link|url)\b/i, kinds: ['link'] },
  { re: /\b(file|files|attachment|copy|it over|send (?:it|that|this))\b/i, kinds: ['any'] },
];

const STOP = new Set(['send', 'share', 'with', 'from', 'that', 'this', 'your', 'have', 'into', 'about', 'there', 'their', 'copy', 'file', 'files', 'final', 'draft', 'version', 'latest', 'update', 'updated']);
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 4 && !STOP.has(w));

export function fileKind(f: { name?: string; mimetype?: string }): Kind {
  const n = (f.name ?? '').toLowerCase();
  const m = (f.mimetype ?? '').toLowerCase();
  if (/presentation|powerpoint|keynote/.test(m) || /\.(pptx?|key|gslides)$/.test(n)) return 'slides';
  if (/spreadsheet|excel|csv/.test(m) || /\.(xlsx?|csv|numbers|gsheet)$/.test(n)) return 'sheet';
  if (/pdf/.test(m) || /\.pdf$/.test(n)) return 'pdf';
  if (/zip|tar|gzip|compressed|x-7z/.test(m) || /\.(zip|tar|tgz|gz|7z|rar)$/.test(n)) return 'archive';
  if (/folder/.test(m)) return 'folder';
  if (/^image\//.test(m) || /\.(png|jpe?g|gif|webp|svg|heic)$/.test(n)) return 'image';
  if (/^video\//.test(m) || /\.(mp4|mov|webm|m4v)$/.test(n)) return 'video';
  if (/word|document|text|markdown|rtf|html/.test(m) || /\.(docx?|md|txt|rtf|gdoc|html?)$/.test(n)) return 'doc';
  return 'any';
}

export function urlKind(u: string): Kind {
  if (/docs\.google\.com\/presentation|\/presentation\/d\//.test(u)) return 'slides';
  if (/docs\.google\.com\/spreadsheets/.test(u)) return 'sheet';
  if (/docs\.google\.com\/document/.test(u) || /quip|confluence|notion|canvas|\/docs\//.test(u)) return 'doc';
  if (/drive\.google\.com\/drive\/folders/.test(u) || /github|git\.soma|bitbucket|gitlab/.test(u)) return 'folder';
  return 'link';
}

/** The matching attachment or link, described in a few words; null when the message does not deliver the item. */
export function deliveryMatch(item: { title: string; purpose?: string | null }, msg: DeliveryMessage): string | null {
  const text = `${item.title} ${item.purpose ?? ''}`;
  const asked = ASKED.filter((a) => a.re.test(text)).flatMap((a) => a.kinds);
  const titleWords = new Set(words(item.title));
  for (const f of msg.files ?? []) {
    const k = fileKind(f);
    const nameHit = words(f.name ?? '').some((w) => titleWords.has(w));
    if (nameHit || asked.includes('any') || asked.includes(k) || (k === 'any' && asked.length > 0)) return `file ${f.name ?? '(unnamed)'}`;
  }
  if (msg.hasFile && asked.length > 0) return 'a file';
  for (const u of msg.urls ?? []) {
    const k = urlKind(u);
    if (asked.includes(k) || (k !== 'link' && asked.includes('link')) || asked.includes('any')) return `link (${k})`;
  }
  return null;
}
