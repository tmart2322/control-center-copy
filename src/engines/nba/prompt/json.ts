/** Pull the first top-level JSON object out of a model reply (tolerates code fences and stray prose). */
export function extractJsonObject(raw: string): { value?: unknown; error?: string } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const start = text.indexOf('{');
  if (start < 0) return { error: 'no JSON object found in the reply' };
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, i + 1)) };
        } catch (e) {
          return { error: `invalid JSON: ${(e as Error).message}` };
        }
      }
    }
  }
  return { error: 'unterminated JSON object (output was probably cut off)' };
}

export interface Issue {
  code: string;
  message: string;
}

export function zodIssues(err: { issues: Array<{ path: Array<string | number | symbol>; message: string }> }): Issue[] {
  return err.issues.map((i) => ({ code: 'schema', message: `${i.path.map(String).join('.') || '(root)'}: ${i.message}` }));
}
