// Size-based log rotation: app.log -> app.log.1 -> ... -> app.log.<keep>.
// Synchronous on purpose: small volume, and no lost lines if the process dies.
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export class RotatingLog {
  /** @param {string} path @param {{maxBytes?: number, keep?: number, scrub?: string[]}} [opts] */
  constructor(path, { maxBytes = 10 * 1024 * 1024, keep = 5, scrub = [] } = {}) {
    this.path = path;
    this.maxBytes = maxBytes;
    this.keep = keep;
    this.scrub = scrub;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.fd = openSync(path, 'a', 0o600);
    this.size = statSync(path).size;
  }

  write(chunk) {
    let text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    for (const s of this.scrub) if (s) text = text.split(s).join('[redacted]');
    const buf = Buffer.from(text);
    if (this.size > 0 && this.size + buf.length > this.maxBytes) this.rotate();
    writeSync(this.fd, buf);
    this.size += buf.length;
  }

  rotate() {
    closeSync(this.fd);
    const oldest = `${this.path}.${this.keep}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = this.keep - 1; i >= 1; i--) {
      if (existsSync(`${this.path}.${i}`)) renameSync(`${this.path}.${i}`, `${this.path}.${i + 1}`);
    }
    renameSync(this.path, `${this.path}.1`);
    this.fd = openSync(this.path, 'a', 0o600);
    this.size = 0;
  }

  close() {
    try {
      closeSync(this.fd);
    } catch {
      /* already closed */
    }
  }
}
