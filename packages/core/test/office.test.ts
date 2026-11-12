import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localLabel, nextOfficeChange, officeOpenAt, officeStatus, presenceFactSource, scheduleProblems, type OfficeSchedule, type Presence } from '../src/index.ts';

// ADM-60..64. The zone is Madeira's; its clocks went back from UTC+1 to UTC+0 on 2026-10-25.
const WEEK = ['09:00-13:00', '14:00-18:00'];
const office: OfficeSchedule = {
  timezone: 'Atlantic/Madeira',
  hours: { mon: WEEK, tue: WEEK, wed: WEEK, thu: WEEK, fri: WEEK },
  closedDates: ['12-25', '2026-11-03'],
};
const at = (iso: string) => new Date(iso);

test('ADM-60: the office is open inside the hours of its own time zone, and daylight saving moves the UTC time', () => {
  // Friday 2026-10-23, summer time (UTC+1): 09:00 local is 08:00Z.
  assert.equal(officeOpenAt(office, at('2026-10-23T07:59:00Z')).open, false);
  assert.equal(officeOpenAt(office, at('2026-10-23T08:00:00Z')).open, true);
  // Monday 2026-10-26, after the clocks went back (UTC+0): 09:00 local is 09:00Z.
  assert.equal(officeOpenAt(office, at('2026-10-26T08:59:00Z')).open, false);
  assert.equal(officeOpenAt(office, at('2026-10-26T09:00:00Z')).open, true);
  assert.equal(officeOpenAt(office, at('2026-10-26T13:00:00Z')).open, false, 'the lunch break: the end of an interval is closed');
  assert.equal(officeOpenAt(office, at('2026-10-26T14:00:00Z')).open, true);
});

test('ADM-60: a closed date closes the whole day, whether it is one day or every year', () => {
  assert.deepEqual(officeOpenAt(office, at('2026-11-03T10:00:00Z')), { open: false, why: 'closed_date' });
  assert.deepEqual(officeOpenAt(office, at('2026-12-25T10:00:00Z')), { open: false, why: 'closed_date' });
  assert.deepEqual(officeOpenAt(office, at('2027-12-25T10:00:00Z')), { open: false, why: 'closed_date' });
  assert.equal(officeOpenAt(office, at('2026-11-04T10:00:00Z')).open, true);
});

test('ADM-61: the next change is found across a weekend and a closed date, and is named in the office\'s own time', () => {
  const fridayClose = nextOfficeChange(office, at('2026-10-30T17:00:00Z'))!; // Friday 17:00 local, open
  assert.equal(fridayClose.toISOString(), '2026-10-30T18:00:00.000Z');
  const monday = nextOfficeChange(office, at('2026-10-30T18:00:00Z'))!; // closed: next opening is Monday
  assert.equal(monday.toISOString(), '2026-11-02T09:00:00.000Z');
  assert.equal(localLabel(monday, office.timezone), 'Monday 09:00');
  // Monday 2026-11-02 evening: Tuesday 2026-11-03 is closed, so the next opening is Wednesday.
  assert.equal(localLabel(nextOfficeChange(office, at('2026-11-02T18:00:00Z'))!, office.timezone), 'Wednesday 09:00');
});

test('ADM-60: a schedule with a bad zone, interval or date reports each problem', () => {
  assert.deepEqual(scheduleProblems(office), []);
  const bad = scheduleProblems({ timezone: 'Mars/Olympus', hours: { mon: ['9-17', '18:00-09:00'], xyz: ['09:00-10:00'] } as never, closedDates: ['25/12'] });
  assert.equal(bad.length, 5);
  assert.match(bad.join('\n'), /Mars\/Olympus.*not an IANA/);
  assert.match(bad.join('\n'), /"9-17" is not HH:MM-HH:MM/);
  assert.match(bad.join('\n'), /ends before it starts/);
  assert.match(bad.join('\n'), /xyz: not a weekday/);
  assert.match(bad.join('\n'), /"25\/12" is not YYYY-MM-DD or MM-DD/);
});

test('ADM-62: a toggle beats the schedule until it expires; without a toggle the schedule decides; with neither a person is assumed', () => {
  const closedNow = at('2026-10-30T19:00:00Z'); // Friday evening
  const out = officeStatus(null, office, closedNow);
  assert.deepEqual([out.onDuty, out.source], [false, 'schedule']);
  assert.equal(out.sentence, 'No person is on duty right now. Staff note: back Monday 09:00. Requests are noted and a person handles them when back.');

  const back: Presence = { state: 'in_office', label: '', since: closedNow.toISOString(), by: 'owner', until: '2026-11-02T09:00:00.000Z' };
  assert.deepEqual([officeStatus(back, office, closedNow).onDuty, officeStatus(back, office, closedNow).source], [true, 'manual']);
  assert.equal(officeStatus(back, office, at('2026-11-02T09:00:00Z')).source, 'schedule', 'the toggle ends when the schedule next changes');

  assert.deepEqual([officeStatus(null, null, closedNow).onDuty, officeStatus(null, null, closedNow).source], [true, 'default']);
  const forgotten: Presence = { state: 'out_of_office', label: 'x', since: '2026-01-01T00:00:00.000Z', by: 'owner' };
  assert.equal(officeStatus(forgotten, null, closedNow).onDuty, false, 'without a schedule a toggle holds until the other command (ADM-51)');
});

test('CMP-27: the on-duty sentence is a runtime fact computed from the clock, never stale', () => {
  const source = presenceFactSource({ getPresence: () => null }, office);
  assert.equal(source.maxAgeMs, null);
  assert.match(source.read(at('2026-10-30T19:00:00Z'))!.sentence, /back Monday 09:00/);
  assert.match(source.read(at('2026-11-02T10:00:00Z'))!.sentence, /A person is on duty/);
});
