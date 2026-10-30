import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MAX_BODY, addToInbox, bearer, deleteFromInbox, hashToken, readInbox, tokenExists } from './_health.js';

/**
 * POST (from the iPhone Shortcut): drop today's Health samples in the inbox.
 * GET (from the diary): read the inbox. DELETE (from the diary): remove
 * imported items. All three need the pairing token as a Bearer token.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).send('storage not configured');
  res.setHeader('cache-control', 'no-store');
  const token = bearer(req.headers.authorization);
  if (!token) return res.status(401).send('missing or malformed token');
  const hash = hashToken(token);
  if (!(await tokenExists(hash))) return res.status(401).send('unknown token — reconnect Apple Health in Mouch!');

  if (req.method === 'POST') {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    if (raw.length > MAX_BODY) return res.status(413).send('too large');
    let body: unknown;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).send('body must be JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).send('body must be a JSON object');
    const r = await addToInbox(hash, body);
    if (r === 'full') return res.status(429).send('inbox full — open Mouch! to import');
    return res.status(200).send('Saved. Open Mouch! to import it.');
  }
  if (req.method === 'GET') return res.status(200).json({ items: await readInbox(hash) });
  if (req.method === 'DELETE') {
    const ids = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body)?.ids;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) return res.status(400).send('ids required');
    await deleteFromInbox(hash, ids.slice(0, 100));
    return res.status(204).end();
  }
  return res.status(405).send('method not allowed');
}
