import type { DeviceState } from './_store.js';
import { minutesOf } from './_store.js';

export interface Message {
  key: string; // dedupe key, e.g. "2026-10-30:morning"
  title: string;
  body: string;
  open: string; // what Mouch! opens when tapped: morning | midday | evening | today | plan | attack
  tag: string;
}

/** How late a missed slot may still be sent (cron hiccups), in minutes. */
const GRACE = 90;
/** Repeating reminders (water, breaks, follow-ups) are sent within this window of their mark, never stacked. */
const WIN = 30;

const due = (at: string | null, minutes: number) => at != null && minutes >= minutesOf(at) && minutes < minutesOf(at) + GRACE;

/** The latest mark at or before `minutes`, if it is still inside its window. */
function current(marks: number[], minutes: number, win: (i: number) => number): { i: number; mark: number } | null {
  let i = -1;
  marks.forEach((m, j) => {
    if (m <= minutes) i = j;
  });
  if (i < 0) return null;
  const mark = marks[i];
  return minutes - mark < win(i) ? { i, mark } : null;
}

/** Marks every `every` minutes from `from` up to and including `to`. */
const series = (from: string, to: string, every: number) => {
  const a = minutesOf(from), b = minutesOf(to), out: number[] = [];
  if (every <= 0 || b < a) return out;
  for (let m = a; m <= b; m += every) out.push(m);
  return out;
};

const fmt12 = (min: number) => {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

type LogId = 'morning' | 'midday' | 'evening' | 'rating';
const LOG_COPY: Record<LogId, Array<[string, string]>> = {
  morning: [
    ['Good morning', 'How did you sleep? The morning log takes a minute.'],
    ['Morning log still open', 'Two taps: your sleep and how you woke up.'],
    ['Last call: morning log', 'Fill it in now while you still remember last night.'],
    ['Morning log', 'Still empty. Even a rough answer helps the forecast.'],
  ],
  midday: [
    ['Midday check', 'Breakfast, lunch and water so far. The midday log is open.'],
    ['Midday log still open', 'What did you eat and drink? Rough is fine.'],
    ['Last call: midday log', 'Your meals are your best clue so far. Log them now.'],
    ['Midday log', 'Still empty. Two minutes is enough.'],
  ],
  evening: [
    ['Evening log is open', 'Dinner, coffee, screen time and stress, then rate the day.'],
    ['Evening log waiting', 'Two minutes, then rate the day.'],
    ['Last call: evening log', 'Log tonight before bed so tomorrow\'s forecast works.'],
    ['Evening log', 'Still empty. Do it now, before you sleep.'],
  ],
  rating: [
    ['How was today?', 'Tap a number. Mouch! tells you what it means before saving.'],
    ['Rate today', 'One tap is enough.'],
    ['Before you sleep: rate today', 'Patterns only work when every day is rated.'],
    ['Rate today', 'Last reminder for today.'],
  ],
};

const WATER_COPY = [
  'Have a glass now. At 2,350 m you lose water faster than you feel it.',
  'A glass now helps keep the afternoon headache away.',
  'Sip some water, then tap to log it.',
  'Water break. Ginger tea counts too.',
  'Small sips add up. One glass now.',
];
const BREAK_COPY = [
  'Look at something far away for 20 seconds, roll your shoulders, sip water.',
  'Stand up, stretch your neck and shoulders for a minute.',
  'Eyes off the screen for a minute. Blink, breathe, drink some water.',
  'Neck tension came before your attacks. Two minutes of stretching now.',
];

/**
 * Pure: which messages are due for this device right now. Weather alerts are
 * added by the caller (they need a fetch). Already-sent keys are filtered out.
 */
export function dueMessages(s: DeviceState, local: { date: string; minutes: number }, nowMs: number): Message[] {
  const out: Message[] = [];
  const blank = { rated: false, morning: false, midday: false, evening: false, waterLow: false, waterL: 0, expDue: false, expDone: false };
  const st = s.status.date === local.date ? { ...blank, ...s.status } : blank;
  const d = local.date;
  const p = s.prefs;
  const now = local.minutes;
  const monthly = d.endsWith('-01');
  const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
  const workday = (p.workdays ?? [1, 2, 3, 4, 5]).includes(weekday);
  const inAttack = !!s.ongoingAttackStart;
  const add = (m: Message) => {
    if (!s.sent.includes(m.key)) out.push(m);
  };

  // Day logs: a first reminder at its time, then follow-ups until it is done.
  const followUps = Math.max(0, Math.min(3, p.followUps ?? 2));
  const gap = Math.max(15, Math.min(240, p.followGap ?? 60));
  const logs: Array<{ id: LogId; at: string | null; done: boolean }> = [
    { id: 'morning', at: p.morning, done: st.morning },
    { id: 'midday', at: p.midday, done: st.midday },
    { id: 'evening', at: p.evening, done: st.evening },
    { id: 'rating', at: p.rating, done: st.rated && !monthly },
  ];
  for (const l of logs) {
    if (!l.at || l.done) continue;
    const base = minutesOf(l.at);
    const marks = Array.from({ length: followUps + 1 }, (_, i) => base + i * gap).filter((m) => m < 24 * 60);
    const hit = current(marks, now, (i: number) => (i === 0 ? GRACE : WIN));
    if (!hit) continue;
    const copy = LOG_COPY[l.id][Math.min(hit.i, 3)];
    const key = hit.i === 0 ? `${d}:${l.id}` : `${d}:${l.id}:${hit.i + 1}`;
    if (l.id === 'rating' && monthly && hit.i === 0)
      add({ key, title: 'Your month is ready for Claude', body: 'Rate today, then export last month from the Plan tab.', open: 'plan', tag: 'rating' });
    else add({ key, title: copy[0], body: copy[1], open: l.id === 'rating' ? (st.evening ? 'today' : 'evening') : l.id, tag: l.id });
  }

  // Water: through the day until the goal is logged; a single reminder if the series is off.
  const goal = p.waterGoal ?? 2;
  if (!inAttack && st.waterL < goal) {
    if ((p.waterEvery ?? 0) > 0) {
      const marks = series(p.waterFrom ?? '09:00', p.waterTo ?? '20:00', p.waterEvery);
      const hit = current(marks, now, () => WIN);
      if (hit) {
        const left = Math.max(0, goal - st.waterL);
        add({
          key: `${d}:water:${hit.mark}`,
          title: st.waterL > 0 ? `Water: ${st.waterL.toFixed(1)} of ${goal} L` : st.waterLow ? 'Water: you were low at midday' : 'Water break',
          body: `${WATER_COPY[hit.i % WATER_COPY.length]} ${left.toFixed(1)} L to go.`,
          open: 'water',
          tag: 'water',
        });
      }
    } else if (due(p.water, now))
      add({ key: `${d}:water`, title: st.waterLow ? 'Water: you were low at midday' : 'Water break', body: WATER_COPY[0], open: 'water', tag: 'water' });
  }

  // Meals: breakfast and lunch on time (both attacks so far started before the first meal).
  if (!inAttack) {
    if (due(p.breakfast, now) && now < minutesOf(p.breakfast!) + WIN)
      add({ key: `${d}:breakfast`, title: 'Breakfast time', body: 'Eat something with protein in the next half hour: ful, shiro, eggs, peanuts. Keep your usual morning cup.', open: 'today', tag: 'meal' });
    if (due(p.lunch, now) && now < minutesOf(p.lunch!) + WIN)
      add({ key: `${d}:lunch`, title: 'Lunch time', body: 'Don\'t skip it. Add some protein, and a glass of water.', open: 'today', tag: 'meal' });
  }

  // Screens: breaks inside work hours on workdays, and "still working?" in the evening.
  if (!inAttack && workday && (p.breakEvery ?? 0) > 0) {
    const marks = series(p.breakFrom ?? '10:00', p.breakTo ?? '18:00', p.breakEvery).slice(1); // not at the very start of the day
    const hit = current(marks, now, () => WIN);
    if (hit) add({ key: `${d}:break:${hit.mark}`, title: 'Screen break', body: BREAK_COPY[hit.i % BREAK_COPY.length], open: 'today', tag: 'break' });
  }
  if (!inAttack && workday && due(p.lateAt, now) && now < minutesOf(p.lateAt!) + WIN)
    add({ key: `${d}:late`, title: `Still working at ${fmt12(now)}?`, body: 'Late nights came before most of your pain days. Wrap up and put the screens away.', open: 'today', tag: 'late' });

  // Sleep: wind down, then bedtime. A bedtime after midnight belongs to the evening before.
  if (p.bed) {
    const bed = minutesOf(p.bed) < 6 * 60 ? minutesOf(p.bed) + 24 * 60 : minutesOf(p.bed);
    const nowX = now < 6 * 60 ? now + 24 * 60 : now;
    const night = now < 6 * 60 ? new Date(Date.parse(`${d}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10) : d;
    const wd = Math.max(0, Math.min(120, p.windDown ?? 30));
    if (wd > 0 && nowX >= bed - wd && nowX < bed - wd + WIN && nowX < bed)
      add({ key: `${night}:winddown`, title: 'Wind down', body: `Bedtime is ${fmt12(bed % 1440)}. Screens off now, dim the lights, a glass of water.`, open: 'evening', tag: 'sleep' });
    if (nowX >= bed && nowX < bed + WIN)
      add({ key: `${night}:bed`, title: 'Bedtime', body: 'Lights out now. A steady bedtime is one of the strongest migraine habits.', open: 'today', tag: 'sleep' });
  }

  // Plan: tick today's experiment.
  if (st.expDue && !st.expDone && due(p.planCheck, now) && now < minutesOf(p.planCheck!) + WIN)
    add({ key: `${d}:plan`, title: 'Did you stick to the plan today?', body: 'Tick today\'s experiment, done or not. Both answers count.', open: 'plan', tag: 'plan' });

  if (p.doses)
    for (const dose of s.doses) {
      const age = nowMs - Date.parse(dose.time);
      if (age >= 2 * 3600_000 && age < 8 * 3600_000)
        add({ key: `dose:${dose.id}`, title: `Did ${dose.name} help?`, body: 'Two hours on. Tap to answer: no, some or full relief.', open: 'today', tag: `dose-${dose.id}` });
    }

  if (p.attackFollowUp && s.ongoingAttackStart) {
    const age = nowMs - Date.parse(s.ongoingAttackStart);
    if (age >= 4 * 3600_000 && age < 24 * 3600_000)
      add({ key: `attack:${s.ongoingAttackStart}`, title: 'Is the attack over?', body: 'Tap "It\'s over" when it ends, so the length is right.', open: 'attack', tag: 'attack' });
  }

  // Never stack: log, sleep, plan and medicine reminders go first. Water, meal and break
  // reminders wait for the next run (15 minutes later, still inside their window), one at a time.
  const AMBIENT = ['meal', 'water', 'break'];
  const firm = out.filter((m) => !AMBIENT.includes(m.tag));
  if (firm.length) return firm;
  const ambient = out.filter((m) => AMBIENT.includes(m.tag)).sort((x, y) => AMBIENT.indexOf(x.tag) - AMBIENT.indexOf(y.tag));
  return ambient.slice(0, 1);
}

/** Weather alert, checked around the evening slot. */
export function weatherMessage(
  s: DeviceState,
  local: { date: string; minutes: number },
  fc: { pressureChange: number | null; aqiTomorrow: number | null; uvTomorrow: number | null },
): Message | null {
  if (!s.prefs.weather) return null;
  const at = s.prefs.evening ?? '19:30';
  if (!(local.minutes >= minutesOf(at) - 60 && local.minutes < minutesOf(at) + GRACE)) return null;
  const parts: string[] = [];
  if (fc.pressureChange != null && Math.abs(fc.pressureChange) >= s.pressureNudgeHpa)
    parts.push(`pressure ${fc.pressureChange > 0 ? 'rises' : 'drops'} ${Math.abs(fc.pressureChange).toFixed(1)} hPa`);
  if (fc.aqiTomorrow != null && fc.aqiTomorrow > 100) parts.push(`air quality is poor (AQI ${fc.aqiTomorrow})`);
  if (fc.uvTomorrow != null && fc.uvTomorrow >= 8) parts.push(`UV is very strong (${fc.uvTomorrow})`);
  if (!parts.length) return null;
  const key = `${local.date}:weather`;
  if (s.sent.includes(key)) return null;
  return {
    key,
    title: 'Heads-up for tomorrow',
    body: `Tomorrow ${parts.join(', ')}. Keep your painkiller with you and protect your sleep tonight.`,
    open: 'today',
    tag: 'weather',
  };
}
