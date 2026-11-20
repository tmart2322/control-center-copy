'use client';
/**
 * Voice dictation via the Web Speech API (ported from VDP's AssistantPanel). `supported` is false where the
 * API is missing, and the mic button is hidden. Listening follows the user's intent: Chrome ends recognition
 * on every pause, so it restarts quietly until an explicit stop or a fatal error. Only final phrases land.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechAlt {
  transcript: string;
}
interface SpeechResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechAlt;
}
interface SpeechEvent {
  resultIndex: number;
  results: { readonly length: number; [index: number]: SpeechResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface DictationApi {
  supported: boolean;
  listening: boolean;
  error: string | null;
  toggle(): void;
  stop(): void;
}

export function useDictation(onText: (append: (prev: string) => string) => void): DictationApi {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const want = useRef(false);
  const restarting = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    const C = ctor();
    if (!C) return;
    setSupported(true);
    const r = new C();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let chunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i]?.isFinal) chunk += e.results[i][0]?.transcript ?? '';
      const text = chunk.trim();
      if (text) onTextRef.current((prev) => `${prev}${prev && !/\s$/.test(prev) ? ' ' : ''}${text}`);
    };
    r.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted' || ev.error === 'network') return;
      want.current = false;
      setListening(false);
      setError(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'Microphone access is blocked. Allow it for this site, then try again.' : `Voice input is unavailable (${ev.error}).`);
    };
    r.onend = () => {
      if (!want.current) return setListening(false);
      if (restarting.current) return;
      restarting.current = true;
      setTimeout(() => {
        restarting.current = false;
        if (!want.current) return;
        try {
          r.start();
        } catch {
          /* already running */
        }
      }, 250);
    };
    rec.current = r;
    return () => {
      want.current = false;
      r.onresult = r.onerror = null;
      r.onend = null;
      try {
        r.abort();
      } catch {
        /* stopped */
      }
      rec.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    want.current = false;
    setListening(false);
    try {
      rec.current?.stop();
    } catch {
      /* stopped */
    }
  }, []);

  const toggle = useCallback(() => {
    if (!rec.current) return;
    if (want.current) return stop();
    setError(null);
    want.current = true;
    setListening(true);
    try {
      rec.current.start();
    } catch {
      /* already running */
    }
  }, [stop]);

  return { supported, listening, error, toggle, stop };
}
