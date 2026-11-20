# Landings: where every record lands, and every write that put it there (D-70)

Status: decided 2026-11-14 (owner asks, this session). Phase 2 builds it; this file is its brief.

## The asks behind it
- "Look at the original canvas items and see the original time logged, then at the new canvas log and see that the event was logged as an update from X hours to Y hours."
- Use cases (and their assets) "need to land in Org62 and VDP, and we need to see whether they landed in neither, one or both systems, and update both accordingly." Assets only land in VDP.
- "Detect if use cases are different in Org62 vs VDP and give you the option to correct it. Since this is data duplication."
- "Make sure this is future proof: who knows where things will need to be logged in the future. I don't want to over-engineer, but it needs to be extensible."

## The model: two tables, nothing else new
**`record_landings`**: one row per (owner, record, destination). The record lands, or should land, in that system.

| column | meaning |
|---|---|
| `record_kind` | `activity_event`, `deal_contribution`, `use_case`, `asset`. A new kind is a new value, not a new table. |
| `record_id` | the app's own row: `activity_entries.id`, `deal_contribution_requests.id`, the use case's app id (below), `vdp_asset_candidates.id` |
| `destination` | `org62` or `vdp`. A new system is a new value. |
| `external_id` | the destination's id once known (Org62 Event / DC / `Use_Case__c` id, VDP use case / asset id) |
| `state` | `not_sent` · `staged` (on a canvas or Outbox item waiting for Apply) · `sent` (applied, not yet seen) · `verified` (read back and matching) · `differs` (read back and not matching what the app holds) · `missing` (sent, never seen) |
| `remote_values` | jsonb: the destination's values at the last read-back (the fields this kind compares) |
| `verified_at`, `last_read_at` | |

**`landing_writes`**: one row per write the app staged: create, update or delete. It is an immutable history; only its state moves.

| column | meaning |
|---|---|
| `landing_id` | the landing it writes |
| `draft_id` | the Outbox item or canvas that carries it (a logging canvas is one draft holding many writes) |
| `op` | `create` · `update` · `delete` |
| `before` | jsonb: the destination's values when the write was staged (null for a create) |
| `after` | jsonb: the values the write sends (for an update, only the changed fields) |
| `state` | `staged` · `sent` · `verified` · `failed` · `removed` (taken off the canvas before Apply) · `rejected` (the canvas was rejected) |
| `created_at`, `sent_at`, `verified_at`, `reason` | why it was staged: "re-derived: hands-on 2 h → 3 h", "use case stage changed in VDP" |

That is all of it. Consequences:
- **A canvas's history** is its `landing_writes`. The original canvas shows `create · Duration 2 h`. A later canvas shows `update · Duration 2 h → 3 h · re-derived`. Both stay readable forever, and the activity row's current hours are just the latest state.
- **Neither / one / both:** for a use case, its two landings (`org62`, `vdp`) give every combination. The UI shows "Org62 ✓ · VDP —".
- **Differs:** the read-back (`org62.readback`, the VDP mirror) writes `remote_values`. A landing whose remote values disagree with the app's record, or with the other system's landing for a use case, becomes `differs`. It shows the fields side by side, you pick the right value, and the correction is a `landing_writes` update to the side that's wrong, on the next canvas or VDP push.
- **Future destinations:** add a `destination` value, a field map (record kind × destination → fields compared and written) and a transport. No schema change.

## Use cases and assets
- **The app's own use case.** One row per use case the app knows, whichever system it came from:
  - its account and opportunity;
  - its fields (name, product, stage, go-live, the VDP fields);
  - its assets underneath (`vdp_asset_candidates` / VDP assets with `use_case_id`, nullable).

  Today a use case lives as `org62_use_cases` (Org62 read-back, with `vdp_use_case_id` and the D-67 `synced_*` values) and in the VDP mirror snapshots. Phase 2 decides whether a small `use_cases` table is needed, or whether `org62_use_cases` + VDP ids can serve as the record. Prefer the smallest change that gives one id per use case for `record_landings.record_id`.
- **Logging use cases:** an approved use case is a row like any other in Log it. It goes on the one Org62 canvas (D-67's Use_Case__c rows), and to VDP through the VDP push. It no longer only "rides along" when Events exist.
- **Assets:** land in VDP only (one landing, `destination = vdp`).

## The canvas
- **One Org62 canvas per batch:** Events (creates and updates), Deal Contributions, Use cases. Lane B already builds it.
- The batch builder writes one `landing_writes` row per canvas row, with the draft's id. Apply → `sent`; read-back → `verified` / `missing`. Remove (canvas review) → `removed`; reject → `rejected`.
- Log it lists canvases (drafts) with their writes. Clicking a canvas shows its rows exactly as written (`after`, and `before` for updates).

## Migration and backfill
- One migration: the two tables, with indexes on (owner, record_kind, record_id, destination) unique, (draft_id), and (state).
- **Backfill from what exists:**
  - activity rows with `org62_event_row_id` / `verified_at` → `verified` landings;
  - rows on applied canvases → `sent` / `verified` writes, with `after` from the row's values;
  - `deal_contribution_requests` and `org62_use_cases` the same way.

  Mark backfilled writes `reason = 'backfill'`. Their `after` is the best known, not a snapshot.
- Nothing is deleted. `activity_entries` keeps its columns (`operation`, `target_org62_event_id`, `org62_event_row_id`, `verified_at`) for now, as a cache the landings explain.

## Not now
- No generic "sync engine", no plug-in registry: a field map per (kind, destination) in code is enough.
- No two-way automatic merge: differences are shown and corrected on your pick, never resolved silently.

## Built (Phase 2, 2026-11-14): what was decided while building, and where it deviates

Migration **0025** (`src/db/schema/landings.ts`): `record_landings`, `landing_writes` and `use_cases`. Not audited
(like `org62_use_cases`): the syncs write them inside a change set or outside one.

- **One pure sync, run by both DataSources** (`src/lib/landings/sync.ts`). The world (the Outbox drafts, the Time rows,
  the DC requests, D-67's use-case plan over the Org62 read-back and the VDP mirror, the asset candidates) says where
  every record stands; the stored rows keep the history. Each writer runs it: the batch builder inside its own
  transaction (on a savepoint, so a failed sync never fails a batch), canvas review Remove and Edit, reject, the VDP
  push (the worker's `vdp.push`) and the Org62 read-back (the worker's `org62.readback`); every landing read runs it
  first too, so a path that did not (an Apply delivered by the worker) is caught up on the next read. Each pass is the
  whole pass and idempotent (a second one changes nothing), under a per-user advisory lock in Postgres.
- **States as specified, three more for writes before a canvas.** A write is `proposed` (an Event update the re-derive
  suggests), `approved` (yours, waiting for the next canvas) or `dismissed` while no draft carries it (`draft_id`
  null). When the batch takes it, the same row moves onto the canvas (its draft and state are what move); taken off
  again, it goes back to waiting as a new `approved` write, so the removed one stays readable. Everything else is the
  brief's: Apply → `sent`, the read-back → `verified` (a create once the record reads back; an update once the field
  reads its new value where the read carries it, else once the record was read back after it was sent), Remove (or an
  Apply that left the row out, or an undone batch) → `removed`, reject → `rejected`, a failed Apply → `failed`.
- **Two columns the brief did not name.** `row_key` (the row's key on its canvas: `event:<id>`,
  `upd:Event:<id15>:Duration__c`, `uc:<VDP id>`, `vdp:<field>`) is how a sync finds a write again (unique per draft).
  `origin` (`canvas` · `vdp` · `proposed` · `backfill`) says where a write came from; backfilled writes carry
  `reason = 'backfill'` too, as asked.
- **Use-case identity: a small `use_cases` table.** One row per use case: its VDP use case id and / or its Org62
  `Use_Case__c` id (15), its VDP, title, account and opportunity. A plan item finds its row by its VDP id, else its
  Org62 id; a row that gains the other id keeps its landings, so an Org62-only use case pushed to VDP stays one use
  case with one history. Two rows that turn out to be one merge into the older. `org62_use_cases` alone could not give
  a VDP-only use case an id.
- **Backfill is the first sync** (no script): a canvas first seen past Apply is history (`reason = 'backfill'`, created
  at the canvas's own time); verified rows (and rows read from Org62) with no canvas get a verified landing only; DC
  requests confirmed in Org62 a verified one; every use case both landings, from the read-back and the mirror; assets
  in VDP, or added there, theirs. On the placeholder seed (the mock, and the db the parity suite loads from it): 11
  landings and 0 writes (the seed has no logging canvas): 5 Time rows (2 verified, 2 missing in Org62, 1 differs) and 3
  use cases × Org62 and VDP (each in VDP, none in Org62 yet); no asset is in VDP or added there. The app's mock adds a
  placeholder Org62 read-back (`CC_MOCK_UC_DEMO`, off in tests) so Use cases shows both, Org62 only and a difference.
- **Assets** land in VDP only. VDP keeps assets per VDP, not per use case, so a use case lists its VDP's assets
  (candidates added or in VDP, and VDP's own); a candidate's landing record id is its id, an asset only VDP has is
  `vdpasset:<VDP asset id>`.
- **Differences and picks.** The compared fields are name, product, stage and go-live (D-67's opportunity and account
  drift stay "change it in Org62"). Which side changed comes from D-67's `synced_*`; product has no synced value, so a
  product difference is always yours to pick. A pick is kept with your other canvas-row edits (`pick:<VDP id>|<field>`
  in `canvas.row_overrides`, undoable), holds only while both values still read as they did, and feeds D-67's plan:
  VDP's value right → an Org62 UPDATE row on the next canvas (any record you own: this widens D-67's "Stage / Go-Live
  only, on records the app created" to the four fields on your explicit pick); Org62's value right → the VDP tree's
  `update_use_case` item, pushed with the rest (VDP's MCP has no track field, so product is corrected in VDP itself).
- **Use cases are rows** (D-67 amended): a use case ready for Org62 is a row of Log it ▸ Ready to log and logs on its
  own or with others (`POST /time/log/batches` takes `useCases` keys, and `updates` write ids; with any of `ids`,
  `useCases`, `updates` given the selection is exact). A use case that asks something (the opp it goes on, a name, an
  account, your DC) is in Needs you; the answer is a row edit (`uc:<VDP id>`: `opportunityId`, `name`), and Leave it
  out of Org62 is D-61's `use_case` decision, now also for one waiting to be created.
- **The re-derive's place.** `POST /time/updates` takes `{activityEntryId, org62EventId, field, from, to, reason}[]`
  (field: Org62's name, or `duration` / `taskType` / `opp`): each a proposed write on the row's Org62 landing, never
  twice the same update. `GET /time/updates` lists them, `PATCH /time/updates/:id` approves, dismisses or restores one.
  The batch puts approved ones (and proposed ones when complete rows are approved with the batch) in the UPDATE table.
- **Reads** (both DataSources, parity-tested): `GET /time/canvases/:id/writes`, `GET /landings/records?kind=&id=`,
  `GET /time/updates`, `GET /activity/use-cases`; mutations `POST /activity/use-cases/:key/pick` and `/fix`.
