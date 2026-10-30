import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, hashToken, registerToken, unregisterToken } from './_health.js';

/** POST: register this diary's pairing token. DELETE: forget it and its inbox. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).send('storage not configured');
  const token = bearer(req.headers.authorization);
  if (!token) return res.status(401).send('missing or malformed token');
  const hash = hashToken(token);
  if (req.method === 'POST') {
    const r = await registerToken(hash);
    return r === 'full' ? res.status(429).send('too many paired devices') : res.status(204).end();
  }
  if (req.method === 'DELETE') {
    await unregisterToken(hash);
    return res.status(204).end();
  }
  return res.status(405).send('method not allowed');
}
