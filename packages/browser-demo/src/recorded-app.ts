import { mountRecorded, type Recorded } from './view.ts';

// The entry of the recorded-only showcase: the replay and nothing else. No framework code, no model call, no key.
const el = document.getElementById('demo');
if (el) {
  fetch('assets/sessions.json')
    .then((r) => r.json())
    .then((recorded: Recorded) => mountRecorded(el, recorded))
    .catch(() => { el.textContent = 'The recorded sessions could not be loaded.'; });
}
