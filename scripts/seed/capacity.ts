/**
 * Prints today's capacity (GET /today `header.capacity`) from the mock DataSource on the seed it loads:
 * the private real seed when it exists, else the committed example. Numbers only by default: real-seed
 * ids and titles can carry customer names, so nothing customer-named reaches a terminal log.
 *
 *   npx tsx scripts/seed/capacity.ts                    # at the seed's asOf + 2 min (08:22 on the real seed)
 *   npx tsx scripts/seed/capacity.ts 13:45              # another time of the seed's day (seed timezone)
 *   npx tsx scripts/seed/capacity.ts --has w_q4_log     # is this item among the pull-forward suggestions?
 *   npx tsx scripts/seed/capacity.ts --ids              # print pull-forward ids (example seed, or local eyes only)
 */
import { MockDataSource } from '../../src/server/datasource/mock';

/** Minutes past local midnight of an instant in an IANA zone. */
function localMinutes(at: Date, timeZone: string): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at).split(':').map(Number);
  return h! * 60 + m!;
}

const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showIds = args.includes('--ids');
  const hasIdx = args.indexOf('--has');
  const has = hasIdx >= 0 ? (args[hasIdx + 1] ?? '').split(',').filter(Boolean) : [];
  const when = args.find((a, i) => !a.startsWith('--') && (hasIdx < 0 || i !== hasIdx + 1));

  const ds = new MockDataSource({ autoplay: false, clockMode: 'seed' });
  const tz = ds.loaded.seed.meta.timezone;
  const asOf = new Date(ds.loaded.seed.meta.asOf);
  let at = new Date(asOf.getTime() + 2 * 60_000);
  if (when) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(when);
    at = m ? new Date(asOf.getTime() + (Number(m[1]) * 60 + Number(m[2]) - localMinutes(asOf, tz)) * 60_000) : new Date(when);
  }
  ds.clock.freeze(at);
  const c = (await ds.getToday({} as never)).header.capacity;
  const ids = c.pullForward.map((p) => p.itemId);
  console.log(
    JSON.stringify(
      {
        seed: ds.loaded.path.endsWith('seed.example.json') ? 'example' : 'private',
        at: `${hhmm(localMinutes(at, tz))} (${tz})`,
        youMinToday: c.youMinToday,
        freeMin: c.freeMin,
        openMin: c.openMin,
        fits: c.fits,
        agentMinBackground: c.agentMinBackground,
        agentRunsBackground: c.agentRunsBackground,
        pullForward: c.pullForward.map((p) => ({ ...(showIds ? { itemId: p.itemId } : {}), youMin: p.youMin, due: p.due })),
        ...(has.length ? { pullForwardHas: Object.fromEntries(has.map((id) => [id, ids.includes(id)])) } : {}),
        legacy: { focusMinLeft: c.focusMinLeft, plannedMin: c.plannedMin, overByMin: c.overByMin },
      },
      null,
      2,
    ),
  );
  ds.dispose();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
