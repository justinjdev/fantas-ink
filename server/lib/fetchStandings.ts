import { yahooFetch } from './yahooFetch.js'

export function fetchLeagueStandings(accessToken: string, leagueKey: string): Promise<unknown> {
  return yahooFetch(accessToken, `/league/${leagueKey}/standings?format=json`, 'standings')
}
