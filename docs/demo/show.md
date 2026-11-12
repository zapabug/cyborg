# Showing the demo (about 5 minutes)

`pnpm run testchat` opens the test chat on this machine. Nothing is sent to anyone: the only thing that leaves the process is the call to the model. Every fact the bot answers from is made up and says so in the header (**DEMO**). Open the address it prints.

## What to say first

- The bot **drafts**; a person approves. Nothing reaches a customer until the business has run it in shadow mode and turned a task on.
- **The code does the numbers.** Prices, totals, running days, closed dates and capacity are computed in code from the business's facts; the model only phrases them.
- Every fact starts **unconfirmed** until the client confirms it.

## The script (type as the customer in the Test tab)

1. **"Hi, how much is the Coast Walk?"** It asks how many people. It gives no price yet: that is a rule in code, not a hope in a prompt. Open *How it got there* under the reply to see the facts it used (marked unconfirmed) and the checks.
2. **"We are 4 people, on Saturday"** The total is computed by the code (160 EUR); a per-person price only appears together with it. Try **"and on Monday?"** to see it refuse a day the tour does not run and offer the nearest open days.
3. **"Yes please, send it"** A booking *request* is made, with a reference (B-000001). Open the **Bookings** tab: a person confirms or declines. Nothing is booked until they do, and nothing is sent to the customer from here.
4. **"Can I bring my dog?"** (not in the facts) It does not guess: the reply is passed to the office. Press **Pass to the office** to see the card the office would get, then open **Questions**, answer it and tick *Remember for the next customers*: the answer becomes an unconfirmed FAQ entry for the next customer.
5. **"Can children come?"** Answered from the facts.
6. **Lessons** tab: add "When you give a price, say pick-up is included." The next reply follows it. A lesson is a short rule a person adds and can retire.
7. **Office box** (bottom of the Test tab): type `status`, `questions`, `bookings`, `save the wording is too long`, or `lang pt` and then `ajuda`. These are the same commands the office uses in WhatsApp.
8. **Save as a simulation script**: the whole chat becomes a script you can replay with `pnpm simulate`.
9. **Advanced** (top right) shows **Audit** (mark each draft against what a person did) and **Log** (everything that happened, and who did it).

## Trying it with a prospect's own business

1. They fill in the intake questionnaire (the nsite). `pnpm intake --form <form-data.js> --message <their message> --out intake` turns it into a draft task list and unconfirmed facts, and a report to read with them.
2. Copy this folder, put their facts in `company.json` (they enter as unconfirmed), remove the `demo` line, and run `pnpm run testchat` again: they test the bot on their own tasks.
3. When a WhatsApp number is linked, the **Configure** tab lists the account's chats and groups by name; they choose what the bot reads and for what. Nothing is read until chosen.
