import type { VercelRequest, VercelResponse } from '@vercel/node';
import { configured } from './_store.js';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  if (!configured()) return res.status(503).json({ error: 'push not configured' });
  res.setHeader('cache-control', 'no-store');
  return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}
