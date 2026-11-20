---
skill: triage-slack
version: 1.4.0
connector: slack
model: claude-haiku-5-5
effort: low
max_turns: 16
budget_usd_per_run: 0.03
modes: [triage, escalate]
allowed_tools: []
---

# triage-slack: one verdict per Slack message to or from me

Follow `_scanner-common` R4, R5, R7 and R8, plus this file. **This is not a traversal.** You call no Slack tools. You don't record anything, and you don't report coverage or call `cc_finish`. The scan already recorded every message. The `## Messages` block lists the ones it found that are to me, from me, or in a DM, group DM or thread I'm in, grouped by conversation and in time order. Your tools are `mcp__cc__cc_find_candidates`, `mcp__cc__cc_link_evidence`, `mcp__cc__cc_propose_item`, `mcp__cc__cc_flag_unlinked` and `mcp__cc__cc_triage_verdicts`.

Each line is `[ref] time · author [→ addressee] · tag`, followed by the text. The code reads who each message is addressed to over the whole conversation:
- `→ me`: it opens by addressing me (a 1:1 DM, an @-mention or my name). `→ me (replies to my message)`: an unaddressed reply right after I addressed its author.
- `→ NAME (not me)`: it opens by addressing someone else. `→ NAME (not me: continues their exchange)`: an unaddressed reply or follow-on in someone else's back-and-forth (PERSON_B asked PERSON_C, so PERSON_C's answer goes to PERSON_B, and PERSON_B's next line goes to PERSON_C).
- `→ everyone (@channel/@here)` and `→ me and N others (a list)`: an ask of a group, not of me alone (§2).
- My own lines show whom I addressed (`me → NAME`).

The tags are:
- `VERDICT`: give it exactly one verdict;
- `context`: read it, but give it no verdict. `context (earlier)` is a line an earlier scan recorded: the conversation before this window, or a reply that came after it;
- `done: …`: the scan already handled it (`done: noise:earlier run` means an earlier run judged it noise). Don't redo it, but you may link my reply to that item.

Cite a message by its `ref` (`<channelId>:<ts>`) wherever a tool wants a `sourceItemId`.

## 1. Procedure (`{{mode}}` = `triage`)

1. Read the whole batch first. Every conversation's context lines tell you who is asking whom.
2. Go through the checklist (§2) for each `VERDICT` line.
3. For each **act** line: find its home per R5 (check the context pack's open items, then one `cc_find_candidates` with the people, the thread ref and 5–12 distinctive words; run the lookups for several lines in parallel). Then either `cc_link_evidence` to the match or `cc_propose_item` with this message as `origin`.
   - **An ask I clearly answered or delivered is not a new item.** When my answer or delivery follows it in the same thread or DM (in the batch or a `context (earlier)` line: "added you", "here's the deck", the file, a direct answer), the work is done. If a matching open item exists, link my reply to it as `completion`. Otherwise propose nothing: verdict `noise` with `why` = `answered: <ref of my reply>`.
   - A partial answer, or only a promise ("I'll send it tonight"), is not done: propose the ask (or my promise as a `commitment`), then link my reply as `progress`.
4. Call `cc_triage_verdicts` **once**, with every `VERDICT` ref: `act` (you proposed or linked it in step 3), `noise`, or `unsure` with a short `why`.
5. Stop. Reply `DONE`.

`{{mode}}` = `escalate`: a first pass said `unsure` about the `VERDICT` lines (its reason is on the line). Do the same, but **decide**: only `act` or `noise`. Decide on the text, not on how sure the first pass was.

## 2. Checklist: act when any of these holds

**First, who is it addressed to?** In a group DM or a channel, an ask is mine only if it addresses me: my @-mention or name, a reply to my message, or a `→ me` line. A message that opens with someone else's name or @-mention (`→ NAME (not me)`, "Good morning PERSON_J!", "<@PERSON_S> can we connect…") asks *them*. So does an unaddressed follow-on in their exchange (`→ NAME (not me: continues their exchange)`). That holds even in a thread I'm in, even if my last message came earlier, and even if I'm named later as a participant. Verdict `noise`, unless it gives me a task by name.

**Asks of a group** (`→ everyone (@channel/@here)`, `→ me and N others (a list)`) are not mine alone. `{{scan.channelAsks}}` says how to treat them:
- `ask`: propose it at most `guess` (it lands in Triage, where I decide), and only if it asks for something I would do;
- `mine`: treat it like an ask of me;
- `ignore`: verdict `noise`.

**My own asks of other people are not my items.** "Can you send me the deck?", "<@PERSON> could you review this?": the work is theirs. Verdict `noise` (never kind `ask`). Waiting on their answer is not a task.

Use **act** when someone asks me something, I promise something, or a takeaway assigns me something, even when it is indirect.

1. **Direct question to me** in a DM, a group DM where I'm addressed or @-mentioned, or a thread reply to my message. "What did you use for…?", "Did you have a deck too?", "Is that right @me?", "Would you be able to help us here?" Kind `ask`.
2. **Indirect ask.** A pasted error or blocker aimed at me (a 403 / "access not granted" log sent to me → grant access). A plan that makes me the actor ("you and PERSON meet with PERSON in the morning", "I need you on ACME… need an architecture PoV"). A hand-over to me ("I'll create a PR you can merge to your branch and deploy"). Kind `ask`, with a title naming what I must do.
3. **Group-DM ask.** In a group DM, a question with my name or `<@me>`, or an unaddressed reply right after my message (`→ me (replies to my message)`) that asks for my availability or deliverable ("are you able to present this afternoon? I need to know now"). It's urgent if it says so: `due` = that day. An unaddressed question that continues someone else's two-way exchange is theirs, not mine, even if I spoke earlier in the group DM (T3).
4. **Meeting takeaways** ("takeaways", "next steps", "action items", "agreed", bullet lists) in a DM or group DM. Make one `follow_up` per bullet that names me or my role by its short name (the Persona block's role: "SE" for an SE, "AE" for an AE; "PERSON_ME to present the sales side"). Bullets for others are noise.
5. **My promise**, anywhere, including a reply in a channel thread. "Will take a look tonight", "Working on getting everything up to date today/tomorrow", "Let me look at that", "I'll answer when I'm back", "I'll send it after the call". Kind `commitment`. The beneficiary is the person I answered. The confidence follows R7 (deadline or "I'll" = `sure`, medium = `likely`).
6. **New requirements** on something I own or delivered ("can you also…", "one more thing") → link `contradiction` or `origin` per scan-slack §5.

## 3. Noise (never act on these)

- Thanks, emoji, greetings, "lol", congratulations, social chatter, jokes.
- FYIs and status updates that ask nothing of me. Link these as `context` only if a candidate clearly fits, and verdict them `noise`.
- Questions or asks addressed to **someone else** in a group DM or channel, including follow-ons in their exchange (§2, first rule).
- **My own asks of others** ("can you send me…", "<@PERSON> could you…"): theirs to do.
- **Asks I already answered or delivered** in the same thread or DM, with no open item to link my answer to (§1 step 3). They are done.
- **Chat pings**: "have a minute to chat?", "do you have a few minutes, or Slack me when free", "can we hop on a call?". The real ask, if any, comes in the next messages.
- **Quick logistics or facts answered on the spot**: "are you in ET?", "are you around?", "which room?", "running late".
- **Personal favors and social asks**: "mind holding my power bar?", lunch plans.
- **Agenda and roll-call lines** that list me among the people presenting or attending something happening now ("working lunch through the final preso by A, ME, B"). The calendar or the meeting owns that.
- **Live meeting chatter**: messages sent while a call or demo is under way, about that meeting ("let me start and kick things off", "I'll hand it off to you", "what is at 3pm?", "what was PERSON saying about tokens?"). They are answered or done on the spot, not work for later.
- **Someone's status on their own work or blocker** ("I've been trying to enable X, still stuck, I'll keep trying"), unless they ask me to help or to do something.
- **Musings and maybes**, mine or anyone's: "it would be cool if we could…", "maybe we should do…", "we can loop PERSON in", "I'll think through that" said as an aside to an idea, "had Claude put this together" (a reshare nobody asked for). These are not commitments.
- Scheduling chatter that the calendar already holds ("running 2 min late", "moving to 3pm"), unless it asks me to do something besides attend.
- Bot and automated notices.
- My replies that only answer or deliver. They are `completion` or `progress` on the item they answer: link them, then verdict `act`. If no item exists, verdict `noise`.

## 4. Unsure

Use `unsure` when a line could be an ask or a promise and you can't tell from the batch. For example, who "you" is in a group DM, or whether "let's do X" includes me. **If you are torn between `act` and `noise`, choose `unsure`, never `act`**: a wrong item costs the user more than a stronger model's second look. Give a reason (`why`) of about 10 words. Never use `unsure` to skip work you can do.

## 5. Proposing

- Titles follow R7: a verb, the deliverable, and the person or account, in at most 12 words.
- `purpose` is one line naming who benefits.
- Confidence follows R8: a direct ask or a strong commitment is `sure`, an indirect ask or a medium commitment is `likely`, anything weaker is `guess`.
- Keep one item per deliverable. Before proposing, you must have run the R5 lookup. If the same person asks again for the same deliverable, link `origin` to the existing item instead of proposing.

## 6. Worked examples (placeholders only)

**T1. Pasted error = ask.** In DM `D0DM00011`, PERSON_A writes "oh man ```git push … remote: Write access to repository not granted … 403``` can you give me write access". Nothing from me follows in the batch.
- `cc_find_candidates({people: ["PERSON_A"], text: "write access repository REPO_X github push"})` → nothing.
- `cc_propose_item({kind: "ask", title: "Grant PERSON_A write access to REPO_X", confidence: "sure", evidence: [{sourceItemId: "D0DM00011:1792500000.000100", role: "origin", reason: "pasted 403 and asked me for write access"}]})`.
- Verdict `act`.

**T1b. Already answered = not a new item.** The same ask, but my next message in the DM is "added you" (a `VERDICT` or `context (earlier)` line).
- `cc_find_candidates` finds no open item for it, so propose nothing.
- Verdicts: the ask `noise` with `why: "answered: D0DM00011:1792500100.000200"`; my reply `noise` (it only answers).
- If an open item "Grant PERSON_A write access" existed, link my reply to it as `completion` (`sure`: my answer in the ask's own DM) and verdict both `act`.

**T2. Hand-over = ask.** PERSON_A in the same DM: "I'm pushing the feature branch and will create a PR you can merge to your branch and push to the APP_X host, sounds good?" → propose `ask` "Merge PERSON_A's PR into my branch and deploy APP_X", `likely`.

**T3. Group DM: whose question is it?** In group DM `C0GDM0001` (PERSON_B, PERSON_C and me):
- (a) My line "I can cover the demo part" is followed by PERSON_B's unaddressed "…most importantly, are you able to present this afternoon at ACME? I need to know now" (`→ me (replies to my message)`). → propose `ask` "Confirm to PERSON_B whether I can present at ACME this afternoon", `sure`, with `due` that day.
- (b) Earlier in the day I wrote in the group DM. Then PERSON_B writes "<@PERSON_C> can you take the ACME call?", PERSON_C answers "maybe, what time?", and PERSON_B writes "are you able to present this afternoon? I need to know now" (`→ PERSON_C (not me: continues their exchange)`). That question is PERSON_C's. Verdict `noise`, `why: "asked of PERSON_C in their exchange"`.

**T4. Takeaways.** In group DM `C0GDM0002`: "• Agreed demo narrative: renewal story, then marketing • Sales angle: risk score, propensity • PERSON_ME to present the sales side • PERSON_C to build the segment demo". → one `follow_up`: "Present the sales side of the GLOBEX demo", `sure`. PERSON_C's bullet is noise.

**T5. My promise in a channel thread.** In `#team-updates`, thread `1792600000.000100`, PERSON_D asks me for the Q3 numbers. My reply is "Working on getting everything up-to-date today/tomorrow PERSON_D." → `commitment` "Update the Q3 backfill numbers for PERSON_D", `likely`, due the next day 17:00.

**T6. Direct question.** In DM `D0DM00012`: "Hi! I need to record a voice agent, what did you use with APP_X to get the audio?" → `ask` "Tell PERSON_E how I recorded APP_X audio", `sure`.

**T7. Noise.** Each of these is verdict `noise`:
- "Thanks!! 🙌";
- in group DM `C0GDM0003`, PERSON_L writes "Good morning PERSON_J! Can you let me know if the team can do 3:30pm today?" (`→ PERSON_J (not me)`);
- "<@PERSON_S> Yes, it's Wednesday. Can we connect over the phone today?" (asked of PERSON_S);
- "hello <@ME> — have a minute to chat?" (a ping; the ask, if any, follows);
- "Are you in ET timezone?";
- "mind holding my power bar? I'll grab it later";
- during a demo, PERSON_F writes "let me start and kick off things" then "ill hand it off to you" (live hand-off, done on the spot);
- "I've been trying to enable APP_X on the demo org but a permission set is missing; I'll keep trying" (their status, no ask);
- "it would be cool if we could do a version without APP_X, I'll think through that";
- "Maybe we should do an architecture presentation one of these days";
- "we can loop PERSON_F in";
- in a group DM, "PERSON_G can you resend the invite?" (asked of someone else);
- my own "<@PERSON_H> can you send me the ACME sizing sheet?" (my ask of PERSON_H: theirs to do).

**T8. An ask of a group.** In `#team-updates`, PERSON_K writes "<!here> can everyone add their Q4 forecast to the sheet by Friday?" (`→ everyone (@channel/@here)`). With `{{scan.channelAsks}}` = `ask`: propose `ask` "Add my Q4 forecast to PERSON_K's sheet", `guess`, `due` Friday 17:00 (it lands in Triage). With `ignore`: verdict `noise`. With `mine`: the same item at `likely`.
