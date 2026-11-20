/**
 * File watcher for Claude sessions. fs.watch (recursive on macOS) with a debounce, plus a periodic sweep as the polling
 * fallback (brief 09 §5.6: fs watch 5 s debounce + 10 min sweep). It only signals "something changed"; the runtime then
 * runs a `file_watch` scan through ClaudeSessionsFetcher.
 */
import { watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ClaudeWatcherOptions {
  sessionsDir?: string;
  projectsDir?: string;
  debounceMs?: number;
  sweepMs?: number;
  onChange: (reason: 'registry' | 'transcript' | 'sweep') => void;
  /** Test seam. */
  watchFn?: typeof watch;
}

export class ClaudeSessionWatcher {
  private watchers: FSWatcher[] = [];
  private timer?: NodeJS.Timeout;
  private sweep?: NodeJS.Timeout;
  private pending: 'registry' | 'transcript' | 'sweep' | null = null;
  private readonly o: Required<Omit<ClaudeWatcherOptions, 'watchFn'>> & { watchFn: typeof watch };
  public mode: 'fs_watch' | 'polling' = 'fs_watch';

  constructor(opts: ClaudeWatcherOptions) {
    const home = homedir();
    this.o = {
      sessionsDir: opts.sessionsDir ?? join(home, '.claude', 'sessions'),
      projectsDir: opts.projectsDir ?? join(home, '.claude', 'projects'),
      debounceMs: opts.debounceMs ?? 5000,
      sweepMs: opts.sweepMs ?? 10 * 60_000,
      onChange: opts.onChange,
      watchFn: opts.watchFn ?? watch,
    };
  }

  private fire(reason: 'registry' | 'transcript' | 'sweep') {
    // Registry flips are the most urgent signal; keep the strongest reason in a debounce window.
    if (!this.pending || reason === 'registry') this.pending = reason;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      const r = this.pending ?? 'sweep';
      this.pending = null;
      this.timer = undefined;
      this.o.onChange(r);
    }, this.o.debounceMs);
  }

  start(): void {
    try {
      this.watchers.push(
        this.o.watchFn(this.o.sessionsDir, { persistent: false }, (_e, name) => {
          if (!name || /^\d+\.json$/.test(String(name))) this.fire('registry'); // ignore the *.key files
        }),
      );
      this.watchers.push(
        this.o.watchFn(this.o.projectsDir, { persistent: false, recursive: true }, (_e, name) => {
          const n = String(name ?? '');
          if (!n || n.endsWith('.jsonl') || n.includes('/subagents/')) this.fire('transcript');
        }),
      );
      for (const w of this.watchers) w.on('error', () => this.fallback());
    } catch {
      this.fallback();
    }
    this.sweep = setInterval(() => this.fire('sweep'), this.o.sweepMs);
    this.sweep.unref?.();
  }

  /** fs.watch is unavailable or died: poll at a modest interval instead. */
  private fallback(): void {
    this.mode = 'polling';
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
    if (this.sweep) clearInterval(this.sweep);
    this.sweep = setInterval(() => this.fire('sweep'), Math.min(this.o.sweepMs, 15_000));
    this.sweep.unref?.();
  }

  stop(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
    if (this.timer) clearTimeout(this.timer);
    if (this.sweep) clearInterval(this.sweep);
    this.timer = undefined;
    this.sweep = undefined;
  }
}
