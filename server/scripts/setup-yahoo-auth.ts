import * as readline from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { buildAuthorizeUrl, exchangeCodeForTokens } from '../lib/yahoo.js'
import { setStoredRefreshToken } from '../lib/storage.js'
import { findByKey, numberedEntries } from '../lib/yahooJson.js'

export interface LeagueTeamKey {
  leagueKey: string
  leagueName: string
  teamKey: string
  teamName: string
}

export function parseLeagueTeamKeys(rawJson: unknown): LeagueTeamKey[] {
  const leaguesContainer = findByKey(rawJson, 'leagues') as Record<string, unknown> | undefined
  if (!leaguesContainer) return []

  return numberedEntries(leaguesContainer).map((leagueWrapper) => {
    const leagueArray = (leagueWrapper as { league: unknown[] }).league
    const leagueKey = findByKey(leagueArray, 'league_key') as string
    const leagueName = findByKey(leagueArray, 'name') as string

    const teamsContainer = findByKey(leagueArray, 'teams') as Record<string, unknown>
    const firstTeamWrapper = numberedEntries(teamsContainer)[0]
    const teamArray = (firstTeamWrapper as { team: unknown[] }).team
    const teamKey = findByKey(teamArray, 'team_key') as string
    const teamName = findByKey(teamArray, 'name') as string

    return { leagueKey, leagueName, teamKey, teamName }
  })
}

async function main() {
  const env = {
    clientId: process.env.YAHOO_CLIENT_ID!,
    clientSecret: process.env.YAHOO_CLIENT_SECRET!,
    redirectUri: process.env.YAHOO_REDIRECT_URI!,
  }
  if (!env.clientId || !env.clientSecret || !env.redirectUri) {
    console.error('Set YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REDIRECT_URI in your environment first.')
    process.exit(1)
  }

  console.log('1. Open this URL in a browser and authorize the app:')
  console.log(buildAuthorizeUrl(env))
  console.log('')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const code = await rl.question('2. Paste the "code" query param from the redirect URL: ')
  rl.close()

  const tokens = await exchangeCodeForTokens(code.trim(), env)
  console.log('Got initial tokens.')
  console.log(`YAHOO_INITIAL_REFRESH_TOKEN=${tokens.refreshToken}`)

  try {
    await setStoredRefreshToken(tokens.refreshToken)
    console.log('Seeded refresh token into Blob storage.')
  } catch (err) {
    console.warn(
      'Could not seed Blob storage from here (this is expected when running locally — Vercel only allows ' +
        'OIDC-based Blob access from real deployments, not local `vercel env pull` sessions). This is fine: ' +
        'the YAHOO_INITIAL_REFRESH_TOKEN printed above is enough — api/cron.ts seeds Blob itself on its first ' +
        'real run.'
    )
    console.warn(`  (${err instanceof Error ? err.message : err})`)
  }

  const response = await fetch(
    'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nhl/leagues/teams?format=json',
    { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
  )
  if (!response.ok) {
    console.error(`Could not list leagues/teams: ${response.status} ${await response.text()}`)
    process.exit(1)
  }
  const raw = await response.json()
  const keys = parseLeagueTeamKeys(raw)

  console.log('')
  console.log('Your NHL leagues/teams — pick the right pair for YAHOO_LEAGUE_KEY / YAHOO_MY_TEAM_KEY:')
  for (const k of keys) {
    console.log(`  ${k.leagueName}: YAHOO_LEAGUE_KEY=${k.leagueKey}  YAHOO_MY_TEAM_KEY=${k.teamKey} (${k.teamName})`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
