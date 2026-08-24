const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2'

export async function fetchLeagueSettings(accessToken: string, leagueKey: string): Promise<unknown> {
  const url = `${BASE_URL}/league/${leagueKey}/settings?format=json`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Yahoo league settings request failed: ${response.status} ${text}`)
  }

  return response.json()
}
