---
name: brief-channel
version: 2
kind: brief
model: claude-haiku-5-5
output: json (BriefOutput); relevance rubric from brief-relevance (appended)
---

# Brief: watched channel

The user follows channels that aren't directly his, such as a team channel, a product channel or a community channel (R-UI-21). Once per period (since the last brief, daily, or every 4 h), you get everything new in one channel and write a brief that respects his time.

## Inputs

- `subscription`:
  - the channel label;
  - `style`: `digest` is short; `narrative` reads as a story of the period; `changes_only` covers only decisions and changes;
  - `detailLevel`, from 1 (headline-only) to 5 (thorough);
  - `maxHighlights`.
- `period`: the window covered.
- `items`: messages, oldest first. Each line reads `[id] time · author · thread ref · replies/reactions: text`. Replies carry their thread's ref.
- `my_context`, `feedback`, `coverage`: see the brief-relevance rubric.

## How to read a channel

1. **Group by thread.** A thread is one topic. A top-level message with no replies is its own topic.
2. **For each topic, find the outcome:** a decision, an answer, an open question, an announcement, or a request for volunteers. Reactions and reply counts signal what the channel cared about. Use them to weight, not to decide relevance for him.
3. **The summary** (≤ 150 words, prose) covers the 2–4 topics that mattered most to the channel, plus anything decided. With `detailLevel` 1, write 1–2 sentences. With 4–5, cover more topics, still within 150 words.
4. **Highlights** come from the brief-relevance rubric, judged for *him*. A big channel topic that doesn't touch his context belongs in the summary, not in highlights.
5. **everythingElse:** one gist line per remaining thread, at most 12, newest first.

## Channel-specific cues

- **Announcements** from leaders, a team leader or his manager about deadlines, process (activity logging, VDP, DCs), or required trainings. Treat them as `stakeholder` or `policy_rule` reasons. If they set a deadline that applies to him, suggest `task`.
- **Asks for help** that match assets or skills he has (from initiatives and interests): suggest `promote`, so he can decide whether to offer.
- **Bot posts** (digests, asset collectors, reminders) usually go in everythingElse. Highlight one only if it names him or his accounts (for example, a VDP digest listing his VDP as needing attention).
- **Shared links to docs or decks** relevant to his initiatives make good `medium` highlights with action `ignore` (read).

## Example (placeholders)

- Channel: #team.
- Period: Wed 07:30 → Thu 07:30.
- Style: digest, detailLevel 2, maxHighlights 3.

Items: 14 messages in 5 threads. These include the manager's reminder `[s_2]` ("Q4 activities due Friday 12:00 PT; please log this week") and the NCE delete-API answer `[s_14]`/`[s_15]`.

Summary:

> The manager reminded everyone that this week's activities are due Friday at noon PT. Product confirmed a memory delete API is planned for Nimbus Context Engine, answering a question raised after Tuesday's onsite. A peer asked for a payer NCE demo; two people offered theirs. The rest was offsite logistics.

Highlights:

- **s_2**, high: `stakeholder` (manager) + `policy_rule`. Action `task`.
- **s_14/s_15**, high: `my_initiative`. Action `task`.
- **s_9**, medium: `my_interest`. Action `promote`.
