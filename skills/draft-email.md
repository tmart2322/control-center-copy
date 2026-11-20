---
name: draft-email
version: 1
kind: draft-style
destination: email (Gmail HTML, email-safe subset)
---

# Draft style: email

This applies to every draft whose destination is email. The composer renders the TipTap doc as email-safe HTML. The user is Slack-first and rarely emails, so his emails are usually customer-facing or formal follow-ups. Write a clean, short, professional email that still sounds like him.

## Email norms

- **Greeting:**
  - "Hi <first name>," for one or two recipients;
  - "Hi all," or "Hi team," for three or more;
  - "Hi <first name> and <first name>," for exactly two.
  - Use no greeting-only fluff ("Hope you're well") unless the voice profile shows he writes it.
- **Opening line:** one sentence of context or thanks, tied to the specific meeting or thread ("Thanks for the time on Tuesday").
- **Body:**
  - Keep it short: 3–8 sentences, or a short intro plus a bullet list.
  - Lists for agreed points and next steps. Each next step names an owner, and a date only when one was agreed.
  - Headings (level 2–3) only for a long recap with distinct parts. Most emails need none.
  - No code blocks. Never use tables (the validator rejects headings above level 3 and code blocks).
- **Links:** put the link on descriptive text ("the reference architecture deck"). Use only URLs from the inputs.
- **Closing line:** one forward-looking sentence ("Happy to set up the working session once the schema's in.").
- **Sign-off:** the voice profile's email sign-off if it has one. Otherwise "Thanks," then a line break, then his first name. No signature block, because Gmail adds it.
- **Subject** (for new emails): specific, at most 8 words, and with no "Re:" unless it's a reply.

## Applying the voice profile

His profile is learned from Slack, so adapt it for email:

- **Keep:**
  - his directness (answer first);
  - his vocabulary and the technical precision he uses;
  - his habit of offering help ("Happy to …") when the profile shows it.
- **Lift the register one notch:**
  - complete sentences;
  - no "lmk", "fyi" or "imo" abbreviations in customer emails;
  - no emoji;
  - contractions are fine.
- **Length:** a customer email can run longer than his Slack median, but stay concise. If the Slack profile is terse, keep the email to the minimum that covers every point.
- Never copy facts, names or links from voice examples.

## Internal email

For an internal recipient (a manager, an AE, ops), keep it as short as a Slack message plus a greeting and sign-off. Internal shorthand (AE, opp, DC) is fine.

## Example (placeholders)

```
Subject: ACME: next steps from Tuesday's discovery

Hi Dana and Lee,

Thanks again for the time on Tuesday. Here's the reference architecture deck we walked through.

Next steps:
• ACME: send the sample member data schema by Friday
• Alex: map the schema to the unified profile before the working session
• Schedule the working session

Happy to set that up once the schema is in. Let me know what times work for your team.

Thanks,
Alex
```
