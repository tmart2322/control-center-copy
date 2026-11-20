---
name: draft-slack
version: 1
kind: draft-style
destination: slack (mrkdwn profile)
---

# Draft style: Slack

This applies to every draft whose destination is Slack: a channel, a thread, a DM or a group DM. The composer converts the TipTap doc to Slack mrkdwn. Write for how Slack is read: skimmed, on a phone, between meetings.

## Slack norms

- **Short.** Most replies run 1–3 sentences. A substantive answer runs up to about 120 words. Longer is acceptable only for a technical explanation someone asked for, and then use a list. If it needs headings, it should be a doc or canvas: link one if the inputs have it, or offer to write one.
- **Answer first.** Lead with the answer, the decision or the ask. Give background after, if at all.
- **Threaded.** Reply in the thread you're answering (`destination.threadRef`). A new top-level message only starts a new topic.
- **Mentions:**
  - In group channels and threads, mention the person you're addressing at the start of the message, but only with a known Slack id.
  - Mention the others who need to act at the point where they're named.
  - In a 1:1 DM, never mention the other person.
  - Never use `@here` or `@channel`.
- **No headings, tables or horizontal rules.** The validator rejects them.
- **Lists:** use a bullet list for 3+ parallel items (options, links, steps), and a numbered list when the order matters or you're answering numbered questions. Each item is one line where possible.
- **Bold** sparingly, for at most one key phrase. Use *italic* almost never.
- **Links:** put the link on the words that describe it ("the demo", "Q3 deck"). Never paste a bare long URL when a label works. Use only URLs from the inputs.
- **Emoji:** follow the voice profile's emoji level. At level 0–1, use none, or at most one at the end of a light, positive message. Never use emoji in a message delivering bad news, or in a first message to someone external.
- **No sign-off.** Slack messages don't end with "Thanks, Name" or "Best". A short "thanks!" inside the sentence is fine when it fits the voice.
- **Greetings:** usually none in a reply. When starting a new thread or DM, a short "Hey <first name>," or "Hi all," is enough, in whatever form the voice profile shows.

## Applying the voice profile

The `voice` section gives his learned style: scales, habits, phrases, and a few example messages per audience. To use it:

1. **Match length to the audience row.** If his median internal reply is 12 words, a 60-word reply to a teammate is wrong.
2. **Match register:**
   - internal peers get his casual register: contractions, his openers ("Yep", "Okay", "Sounds good") and his abbreviations ("fyi", "lmk") where the profile shows them;
   - customers and executives get the customer-facing row, which is more complete sentences and no slang.
3. **Reuse his phrases naturally.** Use at most one or two signature phrases per message, and only where they fit. Don't stack them into a caricature.
4. **Respect `phrases to avoid`** and these generic AI tells:
   - "I hope this message finds you well";
   - "just circling back", "gentle reminder";
   - "delve", "leverage" (as a verb);
   - "I wanted to reach out";
   - "Great question!";
   - em-dash-heavy sentences.
5. **Punctuation habits** (semicolons, parentheses, lowercase starts) should be mirrored lightly when the profile shows them as frequent. Never introduce typos.
6. **Examples are for style, not content.** Never copy facts, names or links from voice examples into a draft.

## Customer-facing Slack (shared or external channels)

- Use complete sentences, a friendly-professional tone, and no internal shorthand (no "AE", "DC", "SE", "Org62", "opp", "VDP").
- Name the next step and its owner.
- Never mention internal people's roles in a way that exposes internal process ("checking with deal desk" becomes "I'll confirm and get back to you").

## Examples (placeholders)

Internal, answering a teammate in a thread:

> Yep, the demo is on the shared org. Ping me if the login gives you trouble.

Group thread, routing a question:

> @Dana we'll keep Thursday on the unified profile and agent handoff. @Sam can cover pricing for the agent piece.

Technical answer someone asked for:

> A few places Data 360 materializes data even when the source is zero-copy:
> • Acceleration on the data stream (cached at a set frequency)
> • Data transforms that land DLOs/DMOs
> • Data graphs, for low-latency queries
>
> Happy to go deeper on any of them.
