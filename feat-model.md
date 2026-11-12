# feat-model: the AI service is set in the dashboard

Written 2026-11-06 from zapa: "where is the api input field for cloud models, it should come preconfigured, any model or local needs to be usable". Branch `feat/wazaa-port`. IDs `MDL-*`. Amends GWY-2 and CMP-1 only where it says so. `PROPOSED` is mine and waits for a yes.

## Why

Today the endpoint and the model are in `company.config.json` and the key is an environment variable named there (CMP-1). That is fine for a developer and wrong for an install on a client's Mac that zapa sets up with some support: nobody should have to edit a file or export a variable. The client pays for their own AI service (the key is theirs); the install must come with the endpoint and model already chosen and ask for the key only.

## Requirements

- MDL-1 The dashboard has a **Model** tab (staff name: "AI service") with: a provider choice, the address (base URL), the model name, the key, a **Test** button and a **Save** button.
- MDL-2 It comes preconfigured. The address and model shown are the ones in `company.config.json` (set by `pnpm tailor --endpoint --model`). With a preconfigured address and model, the person only pastes a key.
- MDL-3 Any OpenAI-compatible endpoint works, cloud or on this machine (GWY-2). The provider choice is a list of presets that fill the address (OpenRouter, OpenAI, a custom address, this machine) and nothing else; a preset never names a model the person did not choose. A key is optional for an address on this machine.
- MDL-4 **Test** runs the capability test (GWY-9) against what is typed, without saving, and says in plain words: works (which level), the key was refused, the address cannot be reached, or the model was not found (GWY-24). A test that is inconclusive says so and is not stored (GWY-17).
- MDL-5 **Save** is allowed only after a Test of exactly those values worked. It stores the capability result (GWY-10) and makes the running install use the new endpoint and model for the next call, with no restart. A module that was refused at start only because no endpoint was tested (MOD-8) loads at the next start; the tab says so.
- MDL-6 **Where the key is kept.** In `model.json` in the install's data folder (the same folder as the store, outside the repository, git-ignored, mode 0600), on the client's machine only. It is never in `company.config.json` (CMP-1 stays: a file that looks like it holds a key is still refused), never in a log, never in the ledger, never on the USB stick, never returned to the page: the page learns only that a key is set. The environment variable named in `inference.apiKeyEnv` still works (CMP-1, GWY-2) when no key was saved here; a key saved in the dashboard is a deliberate choice and wins.
- MDL-7 The address and model saved here are kept in the same `model.json` and win over `company.config.json` at the next start; the config file is not rewritten (it belongs to the customer's repository).
- MDL-8 Changing the endpoint or model is written to the audit table with the operator, without the key (DSH-3). A change marks nothing else unchecked by itself, but ADM-5 applies: the model is a checklist input.
- MDL-9 PRV-7 stays: when the address is not on this machine the tab says in one sentence that customer chat text, with names and numbers replaced, will go to that service, and which account pays for it is the client's.
- MDL-10 The Test and Save routes need the dashboard token like every change (DSH-1); the key travels only in the request body, once.
- MDL-11 `pnpm whatsapp` and `pnpm start` use the same tab; the framework's browser demo keeps its own key box (it never leaves the page).

## OPEN (decide during the build)

- MDL-6 The macOS Keychain instead of a 0600 file (PROPOSED: later, behind the same interface; the file is the first version).
- MDL-3 Which presets ship (PROPOSED: OpenRouter, OpenAI, this machine, a custom address).
- MDL-5 Reloading a module that was refused at start without a restart.

## Milestones

- MD1 settings file, applying it to the config and the live gateway, tests (key never leaves the file; a changed endpoint is used by the next call).
- MD2 the Model tab and the routes, tests, drawn in a browser.
- MD3 wiring in `pnpm whatsapp` (done 2026-11-06) and in `pnpm testchat` (done 2026-11-09, zapa: to try a cloud key in the test chat; the saved settings are applied at start from the data folder beside the store); `pnpm start` does not have the tab yet; the scaffold's README still tells the old way (env var).
