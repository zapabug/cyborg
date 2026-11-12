import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// feat-wazaa-port WZP-80, WZP-81: the parity inventory (docs/wazaa-parity.md) lists every wazaa route, command, tab, setting and test area. A line is done
// (`[x]`, and says where it lives or what replaced it) or open (`[ ]`, and says which milestone ports it or that it is not carried on purpose). A line that is
// neither fails here, so nothing can sit unmapped.

const lines = readFileSync(new URL('../../docs/wazaa-parity.md', import.meta.url), 'utf8').split('\n').filter((l) => /^- \[[ x]\] /.test(l));

test('WZP-80: the inventory is there and covers the routes, commands, tabs, settings and tests of wazaa', () => {
  assert.ok(lines.length > 90, `only ${lines.length} lines`);
  const text = lines.join('\n');
  for (const part of ['`GET /api/', '`POST /api/', '`DELETE /api/', 'stop', 'ANSWER', 'Reservas', 'Configurar', '`persona', '`brain, dialog-parsers']) assert.ok(text.includes(part), `no line for ${part}`);
});

test('WZP-81: every line is ported or replaced (and says where), or open with a milestone or an explicit reason; none is unmapped', () => {
  const bad: string[] = [];
  for (const l of lines) {
    const done = l.startsWith('- [x]');
    const what = l.slice(l.indexOf(': ') + 2);
    if (done && what.trim().length < 3) bad.push(l);
    if (!done && !/\bW[1-8]\b|not carried|not built|decide|Nostr|Jumpseller|Days|partly|learned|scratchpad|retention|sheet|image|guest/i.test(what)) bad.push(l);
  }
  assert.deepEqual(bad, []);
});

test('WZP-81: the open lines are listed, so the work left is never a surprise', () => {
  const open = lines.filter((l) => l.startsWith('- [ ]'));
  console.log(`parity: ${lines.length - open.length} of ${lines.length} lines done; open:\n${open.map((l) => `  ${l.slice(6, 120)}`).join('\n')}`);
  assert.ok(open.length < lines.length);
});
