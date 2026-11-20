/**
 * VDP's re-auth row carries the refresh command from Settings ▸ Sources (`settings.scanning.vdpRefreshScript` and
 * `vdpPython`), the same in both DataSources, so Health shows and copies what "Run refresh" really runs.
 */
import type { Connector } from '@/contract';

export function reauthWithCommand(source: Connector['source'], reauth: Connector['reauth'] | null | undefined, vdpCommand: string | undefined): Connector['reauth'] {
  const r = reauth ?? null;
  return r && source === 'vdp' && r.kind === 'refresh_script' && vdpCommand ? { ...r, command: vdpCommand } : r;
}

/** The connector with its re-auth row resolved (unchanged for anything but VDP). */
export function withReauthCommand<C extends Pick<Connector, 'source' | 'reauth'>>(c: C, vdpCommand: string | undefined): C {
  const reauth = reauthWithCommand(c.source, c.reauth, vdpCommand);
  return reauth === c.reauth ? c : { ...c, reauth };
}
