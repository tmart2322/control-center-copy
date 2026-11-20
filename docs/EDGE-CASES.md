# Edge cases: the round trip between the app, Org62 and VDP

This is the checklist for handing the app to teammates. Every external change must flow in, and anything done in one system must show up in the other. Nothing may show as open once it's done. The rows come from three read-only audits of main at 28f6b2f on 2026-11-12, each of which ran the real code paths (pure engines probed with scratch scripts, targeted tests run).

**Status:**
- **OK**: handled and tested.
- **BUG**: wrong today.
- **GAP**: unhandled.
- **UNTESTED**: probably right, no test.

Every fix lands with a scenario test named after its row ID. A lane flips its rows to OK, with the test name, when it merges.

## Principles every lane follows
1. **The link beats heuristics.** Once a row is tied to an external record (an Org62 Event, DC, Use_Case__c, or a VDP company, VDP or use case), later passes match on that id first. Fallbacks come after: the `CC#` key, then subject and time, then name.
2. **External wins, then flag.** A value a person changed in Org62 or VDP is adopted (or flagged), never overwritten. A staged change whose `before` no longer matches is withdrawn or refused.
3. **Never hide a real external record.** A second Event in a slot, or an overlapping manual log, stays visible with a flag ("possible duplicate"). It is never silently excluded.
4. **Every stuck state has a way out.** Each terminal-looking state (verify_failed, handed_off, unconfirmed, waiting) offers its next action: Log again, Leave out, Withdraw or Re-check.
5. **Preflight before every write.** A canvas or VDP Apply re-checks the live state. It drops rows no longer approved, and it refuses when VDP or Org62 already has the value or something conflicts.
6. **One count map.** Time, quarter totals, receipts, Home and Deals read the same status → count rules.

## Time logging ↔ Org62 Events (lane: time-roundtrip)

Fixed by D-65 (time-roundtrip). Tests: `tests/time/roundtrip.test.ts` (engine, projection, preflight, counts, mock DataSource) and `tests/time/roundtrip-db.test.ts` (Postgres), each named after its row.

**Manual Org62 Events**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| TL-01 | Manual Event: different subject, same start (±5 min) | The proposal closes as its twin | OK (`TL-01 manual Event with another subject and the same start`) |
| TL-02 | Manual Event: start more than 5 min off, a short subject shifted ≤ 1 h, or a timezone shift (±7 h) | Same Related To or account, same day, ≥ 50% overlap counts as a twin, and the proposal closes | OK (`TL-02 start more than 5 min off, a short subject shifted, or a timezone shift`) |
| TL-03 | One Event covering two meetings | It closes every meeting it fully covers | OK (`TL-03 one Event covering two meetings closes every meeting it fully covers`) |
| TL-04 | Two Events for one meeting | Both stay logged; the second is flagged "possible duplicate in Org62" (today it's hidden as overlap; 11 live rows) | OK (`TL-04 two Events for one meeting`, pure and Postgres; migration 0022). Rows an older rule already hid get their week re-projected on the next pass: `TL-04b`, tests/projections/db.test.ts |
| TL-05 | Approved row, then logged manually with a different subject or start | Paired by slot; the approved row closes and never goes on a canvas | OK (`TL-05 approved row, then logged manually …`) |
| TL-06 | Row held on a staged canvas, then logged manually | Apply's preflight drops it (re-render) or refuses | OK (`TL-06 …`: preflight, mock Apply, Postgres Apply) |
| TL-07 | Overlapping meeting logged manually while another is approved in-app | The Org62 Event stays logged (D-18 rule 1; 2 live rows) | OK (`TL-07 overlapping meeting logged manually …`, `TL-04 / TL-07` on Postgres) |
| TL-08 | Non-internal task type with an empty Related To | Flag "Related To empty" | OK (`TL-08 a customer task type with Related To empty …`) |

**App-logged Events edited or deleted in Org62**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| TL-10 | Opp or task type edited in Org62 | Adopted; stays verified | OK |
| TL-11 | Duration, start or end edited in Org62 | Adopted, written once (no rewrite on every pass) | OK (`TL-11 duration, start or end edited in Org62 …`, `TL-11 / TL-13` on Postgres) |
| TL-12 | Subject and start edited in Org62 | Matched by `org62_event_row_id`, adopted, not counted twice | OK (`TL-12 subject and start edited in Org62 …`) |
| TL-13 | Related To cleared in Org62 | The row becomes what_kind none (internal) | OK (`TL-13 …`, `TL-11 / TL-13` on Postgres) |
| TL-14 | App-logged Event deleted in Org62 | "Deleted in Org62", with **Log again** / **Leave out** | OK (`TL-14 …`: derivation, mock and Postgres `resolveActivity`) |
| TL-15 | verify_failed, then fixed in Org62 | Moves back to verified; counted in logged hours | OK (`TL-15 verify_failed, then fixed in Org62 …`, pure and Postgres) |
| TL-16 | AE persona (Sales Events, no task type) | Verifies (today every AE row fails on `null !== ''`) | OK (`TL-16 AE persona …`) |

**Canvas outcomes**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| TL-20 | Canvas applied partially | Missing rows show "Not in Org62" on Time, with Log again | OK (`TL-20 canvas applied partially …`, `TL-14 / TL-20 Log again …`) |
| TL-21 | Slackbot creates a duplicate, or the canvas is executed twice | One verifies, the other is flagged as a duplicate | OK (`TL-21 …`) |
| TL-22 | Slackbot shifts times (UTC as local) | Joined on CC#, so the row verifies; a start difference over 5 min is flagged | OK (`TL-22 …`, `TL-23 / TL-22` on Postgres) |
| TL-23 | CC# key | Description is read back (SOQL), and the join is on `CC#<uuid>`; canvas-parse accepts a UUID | OK (`TL-23 the CC# key …`; scan-org62 1.7.0) |
| TL-24 | Canvas never applied, rows inside it later declined or cancelled | Preflight at Apply; stale canvases expire with a notice | OK (`TL-24 …`: preflight, mock Apply, the Postgres expiry sweep) |
| TL-25 | Rows edited after staging, or the canvas edited in Slack | Held rows are locked (edit = unstage), or the canvas is re-parsed before Apply | OK (`TL-25 …`: edit = unstage, preflight compares the staged cells; mock and Postgres) |
| TL-26 | Canvas applied twice | Only one set of Events (holds plus Slackbot's duplicate rule) | OK |

**Calendar changes**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| TL-30 | Meeting declined, before or after approve/stage/log | Removed, or flagged when logged (D-64) | OK |
| TL-31 | Meeting cancelled after approve or stage | Same as declined | OK (`TL-31 meeting cancelled after approve or stage …`) |
| TL-32 | Meeting rescheduled after approve or log | Re-keyed by event id: the row moves; no stale approved row and no new proposal | OK (`TL-32 …`, pure and Postgres) |
| TL-33 | Recurring exceptions; all-day, multi-day, cross-midnight and DST events; onsite days with accepted meetings | Per instance; every accepted meeting logs | OK |
| TL-34 | Week boundaries | Time reads weeks in the profile TZ, the same as projections | OK (`TL-34 week boundaries …`) |

**Counts, personas, failures**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| TL-40 | Evidence vs meetings, Gemini vs calendar, agent vs human time (engaged time: agent runs count only in part); no hour caps since 2026-11-14 | No double counting | OK |
| TL-41 | Legacy record-type Event | Closes the proposal but isn't counted until re-created | OK (`TL-41 a legacy record-type Event …`) |
| TL-42 | Every read-back batch fails (token expired) | Run failed, Health degraded; nothing inferred | OK (`TL-42 every read-back batch fails …`, Postgres) |
| TL-43 | Worker down for more than 14 days | A longer catch-up floor for org62:events | OK (`TL-43 …`: 120 days) |
| TL-44 | Concurrent passes | Per-week lock (landed with D-64), plus a concurrency test | OK (`TL-44 concurrent passes over one week …`, Postgres) |
| TL-45 | One status → count map across Time, quarter totals, receipts and Home | They agree | OK (`TL-45 one status → count map …`) |

## Deals and DCs ↔ Org62 (lane: dc-roundtrip)

**DC lifecycle**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| DC-01 | DC created manually for a flagged opp | The gap closes on the next read | OK (`DC-01 DC created manually for a flagged opp: the gap closes on the next read (Postgres)`, tests/deals/dc-roundtrip-db.test.ts; mock in tests/deals/dc-roundtrip.test.ts) |
| DC-02 | Waiting request, DC created manually at the same split | The request confirms | OK |
| DC-03 | Waiting add, DC created manually at another split | The request confirms (Org62 wins); no ADD on the canvas | OK (`DC-03 waiting add, DC created manually at another split: the request confirms (Org62 wins), no ADD on the canvas`, tests/deals/dc-roundtrip.test.ts, and its Postgres twin) |
| DC-04 | Waiting change 50→100, Org62 hand-edited to 75 | The change is withdrawn, never overwrites | OK (`DC-04 waiting change 50→100, Org62 hand-edited to 75: withdrawn, never overwrites`, tests/deals/dc-roundtrip.test.ts, and its Postgres twin) |
| DC-05 | Request on a pending canvas, DC lands before Apply | Preflight drops the row | OK (`DC-05 request on a pending canvas, DC lands before Apply: the preflight drops the row`, tests/deals/dc-roundtrip.test.ts; `dcRowStillNeeded`, registered in the canvas Apply preflight by the main session) |
| DC-06 | Canvas applied partially | After the next complete read with no DC: `not_created`, unlocked; the gap comes back; Chase works on Postgres | OK (`DC-06 canvas applied partially: after the next complete read with no DC, not_created and unlocked; the gap comes back; Chase works`, tests/deals/dc-roundtrip.test.ts, and `... Chase works on Postgres`, tests/deals/dc-roundtrip-db.test.ts) |
| DC-07 | Canvas applied twice | One DC (holds) | OK |

**DC changes in Org62**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| DC-10 | Split changed 100↔50 | Needs, VDP scope and pipeline follow; staged VDP items for an account that leaves scope withdraw | OK (`DC-10 split changed 100↔50: staged VDP items for an account that leaves the 100% scope are withdrawn`, tests/deals/dc-roundtrip.test.ts, and `... (Postgres)`, tests/deals/dc-roundtrip-db.test.ts) |
| DC-11 | DC removed (non-team opp) | `dcAssigned` clears; the gap and claim come back | OK (`DC-11 DC removed (non-team opp): dcAssigned clears; the gap and the claim come back`, tests/deals/dc-roundtrip.test.ts, and `... (Postgres)`) |
| DC-12 | Confirmed request, DC later removed | The opp can be a gap again (use the live request only) | OK (`DC-12 confirmed request, DC later removed: the opp can be a gap again (the live request only)`, tests/deals/dc-roundtrip.test.ts) |
| DC-13 | DC reassigned to another SE | Not mine any more (record `SE_Name__c`) | OK (`DC-13 DC reassigned to another SE: not mine any more (SE_Name__c recorded and read)`, tests/deals/dc-roundtrip.test.ts, and `... the gap is back (Postgres)`) |
| DC-14 | Two DCs of mine on one opp (Flex 50/50) | Splits summed per opp | OK (`DC-14 two DCs of mine on one opp (Flex 50/50): splits summed per opp`, tests/deals/dc-roundtrip.test.ts, and `... (Postgres)`) |

**Opps and accounts**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| DC-20 | Opp closed but seen only by the DC read-back; opp reopened but seen only by the book read | The newer source's open/closed state wins | OK (`DC-20 opp closed but seen only by the DC read-back; reopened but seen only by the book read: the newer source wins`, tests/deals/dc-roundtrip.test.ts) |
| DC-21 | Opp moved to another account | The old account's state is cleared | OK (`DC-21 opp moved to another account: the old account loses its state (Postgres)`, tests/deals/dc-roundtrip-db.test.ts; the move read in tests/deals/dc-roundtrip.test.ts) |
| DC-22 | Opp deleted in Org62 | Tombstoned; never a gap | OK (`DC-22 opp deleted in Org62: tombstoned, never a gap (Postgres)`, tests/deals/dc-roundtrip-db.test.ts: the read-back re-reads the opps of a DC question by Id) |
| DC-23 | Child accounts with " - org/product" suffixes under one parent | Read `Account.ParentId`; evidence matches the right child (today `nameCore` merges siblings) | OK without the hierarchy (`DC-23 child accounts with " - org/product" suffixes under one parent: evidence matches the right child`, tests/deals/dc-roundtrip.test.ts): full names match, a shared head picks no child; `MatchAccount.parentOrg62AccountId` is the seam for the vdp-roundtrip lane's Account.ParentId read |
| DC-24 | Account merged in Org62 | The surviving account takes over its links | OK (`DC-24 account merged in Org62: every opp it had moved to one survivor`, tests/deals/dc-roundtrip.test.ts, and `... the surviving account takes over its links (Postgres)`, tests/deals/dc-roundtrip-db.test.ts) |
| DC-25 | Hygiene | Sweeps stale `dcAssigned`, stale account dcStatus and stranded hand-offs | OK (`DC-25 hygiene: sweeps stale dcAssigned, stale account dcStatus and stranded hand-offs; a second sweep finds nothing (Postgres)`, tests/deals/dc-roundtrip-db.test.ts) |

**Set-asides, counts, evidence**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| DC-30 | Set-aside (D-61) across a quarter rollover | The baseline is per quarter | OK (`DC-30 set-aside across a quarter rollover: the baseline is per quarter`, tests/deals/dc-roundtrip.test.ts) |
| DC-31 | Home vs Deals DC counts | One source (`dealsNeeds`); Claim DC marks the finding claimed | OK (`DC-31 Home vs Deals DC counts: one source (dealsNeeds); Claim DC marks the finding claimed`, tests/deals/dc-roundtrip.test.ts, and `... (Postgres)`) |
| DC-32 | A VDP I'm on links an open opp with no DC of mine | Strong evidence: gap reason `vdp`; the VDP shows "Waiting for your DC" with Claim DC, not Past | OK for the gap reason (`DC-32 a VDP I am on links an open opp with no DC of mine: strong evidence, gap reason vdp`, tests/deals/dc-roundtrip.test.ts, and `... (Postgres)`); the VDP's "Waiting for your DC" state is VD-11 (vdp-roundtrip) |
| DC-33 | Meetings or Slack only on a non-team opp | Slack counts as evidence, within the strong-evidence rule | OK for Slack (`DC-33 meetings or Slack only on a non-team opp: Slack counts as evidence, within the strong-evidence rule`, tests/deals/dc-roundtrip.test.ts, and `DC-33 Slack as evidence ... (Postgres)`); a non-team opp on an account outside my book is still never read (no read covers it) |

## VDP ↔ app ↔ Org62 (lane: vdp-roundtrip)

**Company identity**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| VD-01 | Child account with a suffix whose parent company exists in VDP | Matched through the Org62 parent chain and VDP's own name rule (aliases too); no create | OK (tests/vdp/roundtrip.test.ts › VD-01) |
| VD-01b | VDP knows the company by its core ("Northwind" for "Northwind Health"); found live 2026-11-12 | The core is looked up too (a substring search never finds the shorter name) and offered as the best guess (Needs you), never a silent create | OK (`VD-01b …`, tests/vdp/roundtrip.test.ts) |
| VD-01c | A legal name trading as a brand ("… d/b/a Brand"); found live | Looked up by the brand; VDP's company by the brand is the match | OK (`VD-01c …`) |
| VD-01d | The judgment proposes a name to create that VDP already has; found live | The name is looked up before it is proposed; an existing company by VDP's rule becomes the match | OK (`VD-01d …`) |
| VD-01e | A subsidiary brand under a parent VDP knows by its core (a separate brand under a parent company) | The core rule stays inside the name family: the brand is never pre-selected as the parent; a parent-name variant ("… DC/AF") is | OK (`VD-01e …`) |
| VD-02 | Company lookups | Misses cached with a TTL and rotated oldest first; unlooked-up rows disabled ("Not looked up yet") | OK (tests/vdp/roundtrip.test.ts › VD-02; tests/vdp/status.test.ts › VD-02 lookups, VD-02 no company lookup yet) |
| VD-03 | Two child accounts under one parent | One VDP company (per the owner's decision) | OK (tests/vdp/roundtrip.test.ts › VD-03) |
| VD-04 | Sibling whose opps are already on the other sibling's VDP | No Create | OK (tests/vdp/roundtrip.test.ts › VD-04) |
| VD-05 | `create_company` returns created:false | One match: use its id. Several: failed. Never shown as applied | OK (tests/vdp/roundtrip.test.ts › VD-05; tests/vdp/autopilot.test.ts › VD-05) |
| VD-06 | Company merged in VDP | The cached match is invalidated on a dead-id error | OK (tests/vdp/roundtrip.test.ts › VD-06; tests/vdp/roundtrip-db.test.ts › VD-06) |
| VD-07 | A VDP I'm not on exists for the company | `get_company` vdp_count → "N VDPs you're not on"; no `create_vdp` | OK (tests/vdp/roundtrip.test.ts › VD-07) |

**VDP lifecycle**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| VD-10 | VDP made by hand in the VDP UI | Create items close; children re-home (incl. a VDP whose header carries the parent's account id) | OK (tests/vdp/roundtrip.test.ts › VD-10) |
| VD-11 | VDP exists before my 100% DC | "Waiting for your DC", not Past (with DC-32) | OK (tests/vdp/roundtrip.test.ts › VD-11; tests/vdp/gaps.test.ts › VD-11) |
| VD-12 | Opp on two VDPs | `create_vdp` warnings kept; a looks-wrong row | OK (tests/vdp/roundtrip.test.ts › VD-12; tests/vdp/status.test.ts › the summary) |
| VD-13 | Opp moved, deleted or closed while on a VDP | Flagged; dead ids flagged | OK (tests/vdp/roundtrip.test.ts › VD-13: moved, closed, and deleted in Org62 via the DC-22 tombstones) |
| VD-14 | VDP archived, or I'm removed from it | Tombstone "Archived in VDP"; Create never comes back | OK (tests/vdp/roundtrip.test.ts › VD-14) |

**Edits and push**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| VD-20 | Fields filled in VDP's UI | Items close, staged drafts withdraw | OK |
| VD-21 | Apply after a manual edit, before the next read | Adapter preflight (`get_vdp`/`get_use_case`): refuse on a conflict. Owners = live list ∪ new (`set_vdp_owners` replaces the list) | OK (tests/vdp/roundtrip.test.ts › VD-21) |
| VD-22 | Push on a mirror older than 30 min | A read first, or the push is refused | OK, refused (tests/vdp/roundtrip.test.ts › VD-22) |
| VD-23 | Create timed out, or its read-back unconfirmed | "Maybe made" plus a live check; never re-sent blind | OK (tests/vdp/roundtrip.test.ts › VD-23, VD-25) |
| VD-24 | A read withdraws children mid-push | Drafts of a running push are skipped by the withdraw | OK (tests/vdp/roundtrip.test.ts › VD-24; tests/vdp/roundtrip-db.test.ts › VD-24) |
| VD-25 | Parent created by hand mid-push | The live preflight finds it | OK (tests/vdp/roundtrip.test.ts › VD-25) |
| VD-26 | Values edited after staging | Restaged when they differ | OK (tests/vdp/roundtrip-db.test.ts › VD-26) |
| VD-27 | Big push vs VDP's limits (60 calls/min, 20 generations per 10 min, Generate takes 30-90 s) | Shared limiter, 120 s Generate timeout, at most 20 Generates per push | OK (tests/vdp/roundtrip.test.ts › VD-27) |
| VD-28 | Push while signed out | Push gated on sign-in | OK (tests/vdp/roundtrip.test.ts › VD-22 … VD-28) |
| VD-29 | Partial failure, re-push, dry run | Descendants skipped; no second create | OK |

**People, assets, detection**
| ID | Scenario | Expected | Status |
|---|---|---|---|
| VD-30 | Specialist Forecast owner changes after the AE is set | Looks-wrong row with an add suggestion (never a replace) | OK (tests/vdp/roundtrip.test.ts › VD-30) |
| VD-31 | Asset removed in VDP before the next read | Not re-added | OK (tests/vdp/roundtrip.test.ts › VD-31) |
| VD-32 | A required argument is added upstream | `required` is stored and checked | OK (tests/vdp/roundtrip.test.ts › VD-32) |
| VD-33 | Tool removed or added, VDP down | Feature detection; D-69: vdp-app #11 (entitlement leveraged, sales segment) is on while the list is unknown, and a stored list without it disables those items again | OK (tests/vdp/gaps.test.ts › the entitlement leveraged … disabled again when a stored list lacks it) |
| VD-34 | Use-case titles that differ only by a number or a letter ("Use case 1" / "Use case 2", "Agent – Phase 1" / "Phase 2") | Different use cases: `sameUseCaseTitle` matches numbers and other distinguishing tokens (every caller: the live check before create_use_case, the push's look before a create, the Use_Case__c lane's matching) | OK (tests/vdp/gaps.test.ts › VD-34) |
| VD-35 | The identity judgment and the VDP view compute a unit from different inputs (found live: the view had an ambiguous company the job thought judged) | The job takes its pending units from the view's own computation (`vdpIdentityPending`), so every judgment it stores is one the view applies | OK (`VD-35 …`, tests/vdp/roundtrip-db.test.ts) |

## Use cases in both VDP and Org62 (lane: the Use_Case__c session, D-67)
| ID | Scenario | Expected | Status |
|---|---|---|---|
| UC-01 | Match by VDP use-case id, else opp + normalized title | The link (VDP use case id ↔ Use_Case__c id) first, across renames; else any opp of the VDP + `ucSameTitle` (VDP's `sameUseCaseTitle`, and the same numbers: "Phase 1" is never "Phase 2") | OK (tests/time/use-cases.test.ts "UC-01 …") |
| UC-02 | VDP use case missing in Org62 → a canvas row | A USE CASES row (OwnerId me) on the next logging canvas, on the VDP's first open opp with my 100% DC; nothing before the first read | OK ("UC-02 …", tests/vdp/use-cases-db.test.ts) |
| UC-03 | `Use_Case__c` missing in VDP → a `create_use_case` item | A child under Use cases in the VDP tree (title and track from Org62, you type the rest, never autopilot); before a VDP lists the opp it waits on Time ▸ Log it ▸ Use cases in Org62; Leave it closes it | OK ("UC-03 …", tests/time/use-cases-mock.test.ts, db) |
| UC-04 | Drift (Stage, Go-Live, title) → both values shown, never auto-overwritten | Against the last agreed value: only VDP changed → Org62 follows on the canvas (Stage / Go-Live, records the app created that I own) or "change it in Org62"; only Org62 changed or VDP empty → an `update_use_case` item; both changed → you choose. Use_Case__c has no priority field (describe 2026-11-12), so priority can't drift | OK ("UC-04 …") |
| UC-05 | Deleted or inactive on one side | Deleted in Org62: Add it again / Leave it (decisions, Undo); deleted in VDP: Org62-only again (re-add to VDP or Leave it); archived or no-longer-mine VDP: quiet; U07 Lost: VDP is asked to go On Hold | OK ("UC-05 …", db "Add it again …") |
| UC-06 | Primary opp or VDP change → `Opportunity__c` | Opportunity__c / Account__c drift shown with "change it in Org62" (the app writes only Stage / Go-Live); a new row takes the opp's account (keyed by opp) | OK ("UC-06 …") |
| UC-07 | Duplicate `Use_Case__c` | The oldest of mine is the use case; the other is flagged "Duplicate in Org62: delete the extra one there" (never deleted, never linked) | OK ("UC-07 …") |
| UC-08 | Evidence of a new use case → check both systems (past and hidden VDPs included) before proposing | Every `create_use_case` (the tree's "Add a use case", an Org62 → VDP item, the Assistant, a push) is refused with 409 when a VDP of the company (past and gone included), the account's Use_Case__c or a staged VDP create / canvas row has it; hidden VDPs (`get_company` vdp_count) are said, not refused, once the mirror reads the count (VD-07) | OK ("UC-08 …", mock, db) |
| UC-09 | VDP made before my 100% DC; 50% / team-only / closed opps | "Waiting for your 100% DC on <opp>: Claim DC"; nothing is created or read until the DC reads 100% (D-63) | OK ("audit 8 / D-63 …", db "D-63: …") |
| UC-10 | Canvas applied partially; re-push | The next read links what landed; only the missing rows are offered again two days on (Slackbot's duplicate rule skips any that did land) | OK ("ordering: …") |
