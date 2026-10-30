import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MAX_DEVICES, configured, deleteDevice, deviceIds, readDevice, validEndpoint, writeDevice, type DeviceState } from './_store.js';

const ID = /^[A-Za-z0-9-]{8,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const time = (v: unknown, fallback: string | null) => (v === null ? null : typeof v === 'string' && TIME.test(v) ? v : fallback);

/**
 * POST: create or update this device's push state (subscription, schedule,
 * today's status, pending dose checks). DELETE: forget the device.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!configured()) return res.status(503).send('push not configured');
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) ?? {};
  const deviceId = body.deviceId;
  if (typeof deviceId !== 'string' || !ID.test(deviceId)) return res.status(400).send('bad deviceId');

  if (req.method === 'DELETE') {
    await deleteDevice(deviceId);
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).send('method not allowed');

  const prev = await readDevice(deviceId);
  const sub = body.subscription;
  if (!prev && !sub) return res.status(404).send('unknown device');
  if (sub && (!validEndpoint(sub.endpoint) || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string'))
    return res.status(400).send('bad subscription');
  if (!prev && (await deviceIds()).length >= MAX_DEVICES) return res.status(429).send('too many devices');

  const p = body.prefs ?? {};
  const pp = prev?.prefs;
  const st = body.status;
  const loc = body.location;
  const next: DeviceState = {
    deviceId,
    subscription: sub ? { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } : prev!.subscription,
    timeZone: typeof body.timeZone === 'string' && body.timeZone.length < 64 ? body.timeZone : prev?.timeZone ?? 'Africa/Addis_Ababa',
    location:
      loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180
        ? { lat: +(+loc.lat).toFixed(2), lon: +(+loc.lon).toFixed(2) }
        : prev?.location ?? { lat: 9.03, lon: 38.74 },
    prefs: {
      morning: time(p.morning, pp?.morning ?? '08:00'),
      midday: time(p.midday, pp?.midday ?? '13:00'),
      water: time(p.water, pp?.water ?? '16:00'),
      evening: time(p.evening, pp?.evening ?? '19:30'),
      rating: time(p.rating, pp?.rating ?? '21:00'),
      weather: typeof p.weather === 'boolean' ? p.weather : pp?.weather ?? true,
      doses: typeof p.doses === 'boolean' ? p.doses : pp?.doses ?? true,
      attackFollowUp: typeof p.attackFollowUp === 'boolean' ? p.attackFollowUp : pp?.attackFollowUp ?? true,
    },
    pressureNudgeHpa: Number.isFinite(body.pressureNudgeHpa) ? Math.min(20, Math.max(1, body.pressureNudgeHpa)) : prev?.pressureNudgeHpa ?? 6,
    status:
      st && typeof st.date === 'string' && DATE.test(st.date)
        ? { date: st.date, rated: !!st.rated, morning: !!st.morning, midday: !!st.midday, evening: !!st.evening, waterLow: !!st.waterLow }
        : prev?.status ?? { date: '', rated: false, morning: false, midday: false, evening: false, waterLow: false },
    doses: Array.isArray(body.doses)
      ? body.doses
          .filter((x: { id?: unknown; name?: unknown; time?: unknown }) => typeof x?.id === 'string' && typeof x?.name === 'string' && typeof x?.time === 'string' && STAMP.test(x.time))
          .slice(0, 20)
          .map((x: { id: string; name: string; time: string }) => ({ id: x.id.slice(0, 60), name: x.name.slice(0, 40), time: x.time.slice(0, 25) }))
      : prev?.doses ?? [],
    ongoingAttackStart:
      body.ongoingAttackStart === null ? null : typeof body.ongoingAttackStart === 'string' && STAMP.test(body.ongoingAttackStart) ? body.ongoingAttackStart.slice(0, 25) : prev?.ongoingAttackStart ?? null,
    sent: prev?.sent ?? [],
    updatedAt: new Date().toISOString(),
  };
  await writeDevice(next);
  return res.status(204).end();
}
