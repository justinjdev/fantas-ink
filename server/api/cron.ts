// server/api/cron.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getStoredRefreshToken, setStoredRefreshToken, setLatestStandings } from '../lib/storage.js'
import { refreshAccessToken } from '../lib/yahoo.js'
import { fetchLeagueStandings } from '../lib/fetchStandings.js'
import { transformStandings } from '../lib/transform.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const yahooEnv = {
    clientId: process.env.YAHOO_CLIENT_ID!,
    clientSecret: process.env.YAHOO_CLIENT_SECRET!,
    redirectUri: process.env.YAHOO_REDIRECT_URI!,
  }

  try {
    const storedRefreshToken = await getStoredRefreshToken()
    const refreshToken = storedRefreshToken ?? process.env.YAHOO_INITIAL_REFRESH_TOKEN!

    const tokens = await refreshAccessToken(refreshToken, yahooEnv)
    await setStoredRefreshToken(tokens.refreshToken)

    const rawStandings = await fetchLeagueStandings(tokens.accessToken, process.env.YAHOO_LEAGUE_KEY!)
    const payload = transformStandings(rawStandings, process.env.YAHOO_MY_TEAM_KEY!, new Date().toISOString())

    await setLatestStandings(payload)

    res.status(200).json({ ok: true, asOf: payload.asOf })
  } catch (err) {
    console.error('cron refresh failed', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' })
  }
}
