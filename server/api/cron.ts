// server/api/cron.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getStoredRefreshToken,
  setStoredRefreshToken,
  setLatestStandings,
  getCachedLeagueSettings,
  setCachedLeagueSettings,
  type LatestStandingsPayload,
} from '../lib/storage.js'
import { refreshAccessToken } from '../lib/yahoo.js'
import { fetchLeagueStandings } from '../lib/fetchStandings.js'
import { fetchLeagueSettings } from '../lib/fetchLeagueSettings.js'
import { fetchMyMatchups } from '../lib/fetchMyMatchup.js'
import { transformStandings, parseAllTeams, formatRecord } from '../lib/transform.js'
import { parseLeagueSettings, type LeagueSettings } from '../lib/leagueSettings.js'
import { parseMatchups } from '../lib/matchup.js'
import { timingSafeStringEqual } from '../lib/safeCompare.js'

async function resolveLeagueSettings(accessToken: string, leagueKey: string): Promise<LeagueSettings> {
  const cached = await getCachedLeagueSettings()
  if (cached) return cached

  try {
    const raw = await fetchLeagueSettings(accessToken, leagueKey)
    const settings = parseLeagueSettings(raw)
    await setCachedLeagueSettings(settings)
    return settings
  } catch (err) {
    console.error('league settings fetch failed, proceeding without playoff line or categories', err)
    return { categories: [], playoffTeams: null }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const authHeader = req.headers.authorization
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || !timingSafeStringEqual(authHeader ?? '', expected)) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const yahooEnv = {
    clientId: process.env.YAHOO_CLIENT_ID!,
    clientSecret: process.env.YAHOO_CLIENT_SECRET!,
    redirectUri: process.env.YAHOO_REDIRECT_URI!,
  }
  const leagueKey = process.env.YAHOO_LEAGUE_KEY!
  const myTeamKey = process.env.YAHOO_MY_TEAM_KEY!

  try {
    const storedRefreshToken = await getStoredRefreshToken()
    const refreshToken = storedRefreshToken ?? process.env.YAHOO_INITIAL_REFRESH_TOKEN!

    const tokens = await refreshAccessToken(refreshToken, yahooEnv)
    await setStoredRefreshToken(tokens.refreshToken)

    const rawStandings = await fetchLeagueStandings(tokens.accessToken, leagueKey)
    const standings = transformStandings(rawStandings, myTeamKey, new Date().toISOString())

    const settings = await resolveLeagueSettings(tokens.accessToken, leagueKey)

    let currentMatchup: LatestStandingsPayload['currentMatchup'] = null
    let lastMatchup: LatestStandingsPayload['lastMatchup'] = null
    let nextMatchup: LatestStandingsPayload['nextMatchup'] = null
    try {
      const rawMatchups = await fetchMyMatchups(tokens.accessToken, myTeamKey)
      const parsed = parseMatchups(rawMatchups, myTeamKey, settings.categories)
      currentMatchup = parsed.current
      lastMatchup = parsed.last
      if (parsed.next) {
        const allTeams = parseAllTeams(rawStandings)
        const opponentTeam = allTeams.find((t) => t.teamKey === parsed.next!.opponentTeamKey)
        nextMatchup = opponentTeam
          ? {
              opponent: parsed.next.opponent,
              opponentRecord: formatRecord(opponentTeam.wins, opponentTeam.losses, opponentTeam.ties),
            }
          : null
      }
    } catch (err) {
      console.error('matchup fetch failed, proceeding without current/last/next matchup', err)
    }

    const payload: LatestStandingsPayload = {
      ...standings,
      playoffTeams: settings.playoffTeams,
      currentMatchup,
      lastMatchup,
      nextMatchup,
    }

    await setLatestStandings(payload)

    res.status(200).json({ ok: true, asOf: payload.asOf })
  } catch (err) {
    console.error('cron refresh failed', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' })
  }
}
