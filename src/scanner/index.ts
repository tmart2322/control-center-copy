/**
 * Scanner public surface (SCANNER.md). BE-1's worker wires it like this:
 *
 *   const runtime = new ScannerRuntime({
 *     store: new DbScannerStore(db),                 // BE-1, mirrors InMemoryScannerStore (S1–S15)
 *     runner: new AgentSdkSkillRunner(),
 *     specs: [slackSpec(), org62Spec(), ...be2bFetchers.map((f) => deterministicSpec(f))],
 *     reevaluate: enqueueReevaluate,                  // BE-3
 *     clock: workerClock,
 *   });
 *   on tick:        for (const job of await runtime.planJobs()) jobsRepo.enqueue(job)   // kind/dedupe/priority/run_at
 *   on dequeue:     const out = await runtime.executeJob(job.payload, abortSignal); jobsRepo.complete(out)
 *   chat /rescan:   await runtime.runScope({ connector: 'slack', scope: 'inbox' }, 'chat', window)
 *   Health Rescan:  await runtime.runScope(scope, 'manual')
 */
export * from './types';
export * from './store-memory';
export * from './runtime';
export * from './reconcile';
