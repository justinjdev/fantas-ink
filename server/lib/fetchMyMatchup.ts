import { yahooFetch } from './yahooFetch.js'

export function fetchMyMatchups(accessToken: string, teamKey: string): Promise<unknown> {
  return yahooFetch(accessToken, `/team/${teamKey}/matchups?format=json`, 'matchups')
}
