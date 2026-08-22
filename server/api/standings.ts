import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getLatestStandings } from '../lib/storage.js'
import { timingSafeStringEqual } from '../lib/safeCompare.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  if (!process.env.SHARED_TOKEN || !timingSafeStringEqual(token, process.env.SHARED_TOKEN)) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  let payload
  try {
    payload = await getLatestStandings()
  } catch (err) {
    console.error('failed to load standings', err)
    res.status(503).json({ error: 'standings not yet available' })
    return
  }

  if (!payload) {
    res.status(503).json({ error: 'standings not yet available' })
    return
  }

  res.status(200).json(payload)
}
