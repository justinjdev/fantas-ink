import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getLatestStandings } from '../lib/storage.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const token = req.query.token
  if (token !== process.env.SHARED_TOKEN) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const payload = await getLatestStandings()
  if (!payload) {
    res.status(503).json({ error: 'standings not yet available' })
    return
  }

  res.status(200).json(payload)
}
