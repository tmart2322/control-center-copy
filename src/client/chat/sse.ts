/**
 * Incremental Server-Sent Events parser for POST /chat (EventSource cannot POST).
 *
 * Follows the WHATWG event-stream rules that matter here: lines end in \n, \r\n or \r (a trailing \r waits
 * for the next chunk); `:` lines are comments (heartbeats); `data:` lines accumulate and join with \n;
 * one optional space after the colon is stripped; a blank line dispatches. Chunk boundaries may fall
 * anywhere, including inside a multi-byte UTF-8 character (the TextDecoder streams).
 */
import { ChatSseEvent } from '@/contract';

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

export interface SseParser {
  /** Feed decoded text. Complete frames are passed to `onFrame` synchronously. */
  push(text: string): void;
  /** End of stream: a final frame without its blank line is discarded (per spec). */
  end(): void;
}

export function createSseParser(onFrame: (frame: SseFrame) => void): SseParser {
  let buf = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  const dispatch = () => {
    if (data.length) onFrame({ event: event || 'message', data: data.join('\n'), ...(id !== undefined ? { id } : {}), ...(retry !== undefined ? { retry } : {}) });
    event = '';
    data = [];
    retry = undefined;
  };

  const line = (l: string) => {
    if (l === '') return dispatch();
    if (l.startsWith(':')) return;
    const colon = l.indexOf(':');
    const field = colon === -1 ? l : l.slice(0, colon);
    let value = colon === -1 ? '' : l.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value.includes('\0') ? id : value;
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
  };

  return {
    push(text) {
      buf += text;
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c !== '\n' && c !== '\r') continue;
        if (c === '\r' && i === buf.length - 1) break; // might be \r\n split across chunks
        line(buf.slice(start, i));
        if (c === '\r' && buf[i + 1] === '\n') i++;
        start = i + 1;
      }
      buf = buf.slice(start);
    },
    end() {
      if (buf.endsWith('\r')) {
        line(buf.slice(0, -1));
        buf = '';
      }
      buf = '';
      event = '';
      data = [];
    },
  };
}

/** Read a byte stream to completion (or abort), calling `onFrame` per event. Resolves when the stream ends. */
export async function readSseStream(body: ReadableStream<Uint8Array>, onFrame: (frame: SseFrame) => void, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(onFrame);
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort);
  try {
    while (true) {
      if (signal?.aborted) throw abortError();
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
    if (signal?.aborted) throw abortError();
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* reader already released */
    }
  }
}

export function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

export function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError';
}

/**
 * Frame → contract event. Returns null for heartbeats, `hello`, unparseable JSON and unknown shapes, so a
 * newer server can add event types without breaking an older client.
 */
export function parseChatFrame(frame: SseFrame): ChatSseEvent | null {
  if (frame.event === 'hello' || !frame.data) return null;
  let json: unknown;
  try {
    json = JSON.parse(frame.data);
  } catch {
    return null;
  }
  const r = ChatSseEvent.safeParse(json);
  return r.success ? r.data : null;
}
