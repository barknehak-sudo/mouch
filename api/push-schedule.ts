/* eslint-disable @typescript-eslint/no-explicit-any */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import webpush from 'web-push';
import { configured, deleteDevice, deviceIds, localNow, readDevice, writeDevice } from './_store.js';
import { dueMessages, weatherMessage, type Message } from './_schedule.js';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Tomorrow's pressure change and air quality for the device's location. */
async function tomorrowConditions(lat: number, lon: number, today: string) {
  const out = { pressureChange: null as number | null, aqiTomorrow: null as number | null, uvTomorrow: null as number | null };
  try {
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=surface_pressure&forecast_days=2&timezone=auto`).then((r) => r.json() as Promise<any>);
    const byDay = (pred: (t: string) => boolean) => avg(w.hourly.time.flatMap((t: string, i: number) => (pred(t) && w.hourly.surface_pressure[i] != null ? [w.hourly.surface_pressure[i]] : [])));
    const t0 = byDay((t) => t.startsWith(today));
    const t1 = byDay((t) => !t.startsWith(today));
    if (t0 != null && t1 != null) out.pressureChange = Math.round((t1 - t0) * 10) / 10;
  } catch {
    /* skip pressure */
  }
  try {
    const a = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=us_aqi,uv_index&forecast_days=2&timezone=auto`).then((r) => r.json() as Promise<any>);
    const idx = a.hourly.time.map((t: string, i: number) => (t.startsWith(today) ? -1 : i)).filter((i: number) => i >= 0);
    const aqi = idx.map((i: number) => a.hourly.us_aqi[i]).filter((v: number | null) => v != null);
    const uv = idx.map((i: number) => a.hourly.uv_index[i]).filter((v: number | null) => v != null);
    if (aqi.length) out.aqiTomorrow = Math.round(Math.max(...aqi));
    if (uv.length) out.uvTomorrow = Math.round(Math.max(...uv) * 10) / 10;
  } catch {
    /* skip air */
  }
  return out;
}

/**
 * Vercel cron, every 15 minutes. For each device: work out its local time,
 * send whatever is due (morning, midday, water, evening, rating, dose checks,
 * attack follow-up, tomorrow's weather), and remember what was sent.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).send('unauthorized');
  if (!configured()) return res.status(503).send('push not configured');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'https://mouch.vercel.app', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  const results = { devices: 0, sent: 0, removed: 0, failed: 0 };
  for (const id of await deviceIds()) {
    const s = await readDevice(id);
    if (!s) continue;
    results.devices++;
    const local = localNow(s.timeZone);
    const msgs: Message[] = dueMessages(s, local, Date.now());
    const evening = s.prefs.evening ?? '19:30';
    const [h, m] = evening.split(':').map(Number);
    const near = Math.abs(local.minutes - (h * 60 + m)) <= 90;
    if (near && s.prefs.weather && !s.sent.includes(`${local.date}:weather`)) {
      const w = weatherMessage(s, local, await tomorrowConditions(s.location.lat, s.location.lon, local.date));
      if (w) msgs.push(w);
    }
    if (!msgs.length) continue;

    let gone = false;
    for (const msg of msgs) {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({ title: msg.title, body: msg.body, open: msg.open, tag: msg.tag }), { TTL: 3 * 3600, urgency: 'normal' });
        s.sent.push(msg.key);
        results.sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          gone = true;
          break;
        }
        results.failed++;
      }
    }
    if (gone) {
      await deleteDevice(id);
      results.removed++;
      continue;
    }
    // Keep the sent log short: today and the two days before, plus dose/attack keys.
    const keep = new Set([local.date, ...[1, 2].map((n) => new Date(Date.parse(local.date) - n * 86400_000).toISOString().slice(0, 10))]);
    s.sent = s.sent.filter((k) => (k.includes(':') && keep.has(k.slice(0, 10))) || k.startsWith('dose:') || k.startsWith('attack:')).slice(-60);
    await writeDevice(s);
  }
  console.log('push-schedule', JSON.stringify(results));
  return res.status(200).json(results);
}
