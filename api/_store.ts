import { get, list, put, del } from '@vercel/blob';

/**
 * Push state lives in the project's private Vercel Blob store, one JSON file
 * per device. It holds only what scheduling needs — no diary entries.
 */

export interface NotifyPrefs {
  morning: string | null;
  midday: string | null;
  water: string | null;
  evening: string | null;
  rating: string | null;
  weather: boolean;
  doses: boolean;
  attackFollowUp: boolean;
}

export interface DeviceState {
  deviceId: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  timeZone: string;
  location: { lat: number; lon: number };
  prefs: NotifyPrefs;
  pressureNudgeHpa: number;
  /** What's already filled today (client's local date), so done things aren't nagged. */
  status: { date: string; rated: boolean; morning: boolean; midday: boolean; evening: boolean; waterLow: boolean };
  /** Doses waiting for the 2-hour "did it help?" question. */
  doses: Array<{ id: string; name: string; time: string }>;
  ongoingAttackStart: string | null;
  /** Keys of notifications already sent, e.g. "2026-10-30:morning". Pruned to 3 days. */
  sent: string[];
  updatedAt: string;
}

const PATH = (id: string) => `push/devices/${id}.json`;
export const MAX_DEVICES = 10;

export const configured = (): boolean => !!process.env.BLOB_READ_WRITE_TOKEN && !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;

export async function readDevice(id: string): Promise<DeviceState | null> {
  const r = await get(PATH(id), { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}

export async function writeDevice(s: DeviceState): Promise<void> {
  await put(PATH(s.deviceId), JSON.stringify(s), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function deleteDevice(id: string): Promise<void> {
  await del(PATH(id));
}

export async function deviceIds(): Promise<string[]> {
  const { blobs } = await list({ prefix: 'push/devices/', limit: 100 });
  return blobs.map((b) => b.pathname.replace('push/devices/', '').replace('.json', ''));
}

/** Only real browser push services; never post to arbitrary URLs. */
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.push\.apple\.com$/, /\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.mozaws\.net$/];
export function validEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string') return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/** Local date and minutes-after-midnight in a time zone. */
export function localNow(timeZone: string, now = new Date()): { date: string; minutes: number } {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = 'Africa/Addis_Ababa';
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
