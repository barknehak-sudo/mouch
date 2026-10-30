import { createHash } from 'node:crypto';
import { del, get, list, put } from '@vercel/blob';

/**
 * Apple Health inbox. The iPhone Shortcut posts samples with a pairing token;
 * the diary pulls them on open and they're deleted. Only the token's SHA-256
 * is stored, never the token.
 */
export const MAX_TOKENS = 10;
export const MAX_INBOX = 60;
export const MAX_BODY = 32 * 1024;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const TOKEN_PATH = (hash: string) => `health/tokens/${hash}.json`;
const INBOX = (hash: string) => `health/inbox/${hash}/`;

export function bearer(header: string | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(header?.trim() ?? '');
  return m ? m[1] : null;
}

export async function tokenExists(hash: string): Promise<boolean> {
  const r = await get(TOKEN_PATH(hash), { access: 'private', useCache: false });
  return !!r && r.statusCode === 200;
}

export async function registerToken(hash: string): Promise<'ok' | 'full'> {
  if (!(await tokenExists(hash))) {
    const { blobs } = await list({ prefix: 'health/tokens/', limit: MAX_TOKENS + 1 });
    if (blobs.length >= MAX_TOKENS) return 'full';
  }
  await put(TOKEN_PATH(hash), JSON.stringify({ createdAt: new Date().toISOString() }), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return 'ok';
}

export async function unregisterToken(hash: string): Promise<void> {
  const { blobs } = await list({ prefix: INBOX(hash), limit: 1000 });
  await Promise.all([del(TOKEN_PATH(hash)), ...blobs.map((b) => del(b.url))]);
}

export async function addToInbox(hash: string, body: unknown): Promise<'ok' | 'full'> {
  const { blobs } = await list({ prefix: INBOX(hash), limit: MAX_INBOX + 1 });
  if (blobs.length >= MAX_INBOX) return 'full';
  const receivedAt = new Date().toISOString();
  await put(`${INBOX(hash)}${Date.now()}.json`, JSON.stringify({ receivedAt, body }), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: true,
  });
  return 'ok';
}

export async function readInbox(hash: string): Promise<Array<{ id: string; receivedAt: string; body: unknown }>> {
  const { blobs } = await list({ prefix: INBOX(hash), limit: MAX_INBOX });
  const out = [];
  for (const b of blobs) {
    const r = await get(b.url, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) continue;
    const item = JSON.parse(await new Response(r.stream).text());
    out.push({ id: b.pathname.slice(INBOX(hash).length), receivedAt: item.receivedAt, body: item.body });
  }
  return out.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

export async function deleteFromInbox(hash: string, ids: string[]): Promise<void> {
  const { blobs } = await list({ prefix: INBOX(hash), limit: MAX_INBOX });
  const keep = new Set(ids);
  await Promise.all(blobs.filter((b) => keep.has(b.pathname.slice(INBOX(hash).length))).map((b) => del(b.url)));
}
