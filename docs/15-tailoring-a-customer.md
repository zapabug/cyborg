# Tailoring a customer: from the form to the test chat (feat-tailored T1, T2)

How a prospect's answers become a working test chat on zapa's machine. Nothing is sent to anyone; the model call is the only thing that leaves the machine.

## 0. First contact and research (feat-desk DSK-84..88)

The first contact is five answers: the company name, the website, where else it is online, what takes the most time, what to automate first. Before the call, zapa runs `pnpm research --name "<Company>" --url <website> --out <folder> --endpoint <url ending /v1> --model <model>`. It reads the public pages (the ones given and same-site pages they point to), asks the model only to copy, drops every line whose words are not on a fetched page, and writes `sheet.draft.txt` (the sheet format, each line preceded by its source), `research-report.md` (what was found, what was dropped and why, what to ask on the call) and `sources/`. Pass the draft to step 2 with `--sheet`: the first bot exists before the call, every fact unconfirmed, and the call confirms it line by line. Tone and what the bot never says are never taken from a website.

## 1. The prospect fills in the forms (pleb.world/wazaa/intake)

- **Your business** (`business.html`): name, tone, where, hours, payment, services (one per line, `name | price | note`, "from 30 EUR" when it depends), questions (`question | answer`), never (one per line).
- **Your daily work** (`questionnaire.html`): the tasks and eight questions (what to automate, what is never automatic).
- Both send privately to the wazaa team (the Nostr layer), or can be copied.

## 2. Build the customer repository

Save the two messages to files, then, from the framework folder:

```sh
pnpm tailor <id> --name "<Company name>" --into ~/Projects/cyborg \
  --sheet <business message> --intake <questionnaire message> --form <intake form-data.js> \
  --language en|pt --endpoint <url ending /v1> --model <model> [--key-env NAME]
```

`--sheet` and `--intake` are each optional, but one is needed. The command prints what it read, the line it could not read (with the line number) and what to ask the client next. Every fact is unconfirmed. The client's own words are kept in `docs/business-sheet.txt` and `docs/intake-message.txt`.

## 3. Try it

```sh
cd ~/Projects/cyborg/<id> && pnpm install && pnpm testchat
```

Open the address it prints. **The business** tab holds the sheet: edit it with the client and press *Use this*; the **Test** tab answers from it at once. The second box types as the office.

## 4. Link WhatsApp (the framework's own channel)

```sh
cd ~/Projects/cyborg/<id> && pnpm whatsapp
```

`@cyborg/channel-whatsapp` is part of the framework (moved out of the Demo Tours repository on 2026-11-06). It tests the model endpoint, seeds `company.json`'s facts (unconfirmed, never over an existing one), opens the dashboard and draws a QR code in the terminal and in the dashboard. Scan it with the business's WhatsApp. Nothing is watched or sent until a person ticks chats in the **Configure** tab; the choice is written to `whatsapp.json` (git-ignored) by the adapter. Session, store and vault are under `data/` (git-ignored). Shadow only: drafts go to the review chat, never to a customer.

## 5. Not yet

The fix menu and replay, the business's own automation switch, the time-slot and calendar parts. See `feat-tailored.md`.
