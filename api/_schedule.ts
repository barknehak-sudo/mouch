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

const due = (at: string | null, minutes: number) => at != null && minutes >= minutesOf(at) && minutes < minutesOf(at) + GRACE;

/**
 * Pure: which messages are due for this device right now. Weather alerts are
 * added by the caller (they need a fetch). Already-sent keys are filtered out.
 */
export function dueMessages(s: DeviceState, local: { date: string; minutes: number }, nowMs: number): Message[] {
  const out: Message[] = [];
  const st = s.status.date === local.date ? s.status : { rated: false, morning: false, midday: false, evening: false, waterLow: false };
  const d = local.date;
  const p = s.prefs;
  const monthly = d.endsWith('-01');

  if (due(p.morning, local.minutes) && !st.morning)
    out.push({ key: `${d}:morning`, title: 'Good morning', body: 'How did you sleep? The morning log takes a minute.', open: 'morning', tag: 'morning' });
  if (due(p.midday, local.minutes) && !st.midday)
    out.push({ key: `${d}:midday`, title: 'Midday check', body: 'Breakfast, lunch and water so far. The midday log is open.', open: 'midday', tag: 'midday' });
  if (due(p.water, local.minutes))
    out.push({
      key: `${d}:water`,
      title: st.waterLow ? 'Water: you were low at midday' : 'Water break',
      body: 'Have a glass of water now. At 2,350 m you lose water faster than you feel it.',
      open: 'today',
      tag: 'water',
    });
  if (due(p.evening, local.minutes) && !st.evening)
    out.push({ key: `${d}:evening`, title: 'Evening log is open', body: 'Dinner, coffee, screen time and stress, then rate the day.', open: 'evening', tag: 'evening' });
  if (due(p.rating, local.minutes) && (!st.rated || monthly))
    out.push(
      monthly
        ? { key: `${d}:rating`, title: 'Your month is ready for Claude', body: 'Rate today, then export last month from the Plan tab.', open: 'plan', tag: 'rating' }
        : { key: `${d}:rating`, title: 'How was today?', body: 'Tap a number. Mouch! tells you what it means before saving.', open: st.evening ? 'today' : 'evening', tag: 'rating' },
    );

  if (p.doses)
    for (const dose of s.doses) {
      const age = nowMs - Date.parse(dose.time);
      if (age >= 2 * 3600_000 && age < 8 * 3600_000)
        out.push({ key: `dose:${dose.id}`, title: `Did ${dose.name} help?`, body: 'Two hours on. Tap to answer: no, some or full relief.', open: 'today', tag: `dose-${dose.id}` });
    }

  if (p.attackFollowUp && s.ongoingAttackStart) {
    const age = nowMs - Date.parse(s.ongoingAttackStart);
    if (age >= 4 * 3600_000 && age < 24 * 3600_000)
      out.push({ key: `attack:${s.ongoingAttackStart}`, title: 'Is the attack over?', body: 'Tap "It\'s over" when it ends, so the length is right.', open: 'attack', tag: 'attack' });
  }

  return out.filter((m) => !s.sent.includes(m.key));
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
