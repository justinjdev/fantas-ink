import { yahooFetch } from './yahooFetch.js'

export function fetchLeagueSettings(accessToken: string, leagueKey: string): Promise<unknown> {
  return yahooFetch(accessToken, `/league/${leagueKey}/settings?format=json`, 'league settings')
}
