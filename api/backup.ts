import type { VercelRequest, VercelResponse } from '@vercel/node';
import { get, list, put, del } from '@vercel/blob';

/**
 * Encrypted diary backups. The phone encrypts the diary with a key made from
 * its backup code before sending it, and names it by a hash of that code, so
 * this server only ever holds ciphertext it cannot read.
 *
 * Authorization: Bearer <64 hex chars, the backup id>
 * PUT {v, salt, iv, data}: store. GET: fetch. DELETE: forget it.
 */
const PATH = (id: string) => `backup/${id}.json`;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_BACKUPS = 20;

const idOf = (h: string | undefined) => {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(h ?? '');
  return m ? m[1] : null;
};
const b64 = (s: unknown, max: number) => typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9+/=]+$/.test(s);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).send('storage not configured');
  const id = idOf(req.headers.authorization);
  if (!id) return res.status(401).send('missing or malformed backup id');

  if (req.method === 'GET') {
    const r = await get(PATH(id), { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return res.status(404).send('no backup for this code');
    res.setHeader('content-type', 'application/json');
    return res.status(200).send(await new Response(r.stream).text());
  }

  if (req.method === 'PUT') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || body.v !== 1 || !b64(body.salt, 64) || !b64(body.iv, 64) || !b64(body.data, MAX_BYTES))
      return res.status(400).send('not a Mouch! backup');
    const { blobs } = await list({ prefix: 'backup/', limit: 1000 });
    if (!blobs.some((b) => b.pathname === PATH(id)) && blobs.length >= MAX_BACKUPS) return res.status(429).send('backup storage is full');
    const saved = new Date().toISOString();
    await put(PATH(id), JSON.stringify({ v: 1, salt: body.salt, iv: body.iv, data: body.data, saved }), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    return res.status(200).json({ saved });
  }

  if (req.method === 'DELETE') {
    await del(PATH(id)).catch(() => {});
    return res.status(204).end();
  }
  return res.status(405).send('method not allowed');
}
