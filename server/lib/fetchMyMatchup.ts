const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2'

export async function fetchMyMatchups(accessToken: string, teamKey: string): Promise<unknown> {
  const url = `${BASE_URL}/team/${teamKey}/matchups?format=json`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Yahoo matchups request failed: ${response.status} ${text}`)
  }

  return response.json()
}
