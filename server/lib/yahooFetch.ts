const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2'

// A hung Yahoo connection with no timeout can burn a serverless function's
// entire budget, defeating the "degrade gracefully" goal for every field in
// the payload, not just the one that was fetching - every Yahoo Fantasy API
// call goes through here so none of them can do that. The separate OAuth
// token endpoint (server/lib/yahoo.ts's postToken, a different base URL,
// method, and auth scheme, so it can't call yahooFetch directly) uses this
// same exported constant so it's covered too - it's the *first* network
// call cron.ts makes, ahead of any of the three calls this file guards.
export const YAHOO_TIMEOUT_MS = 8000

export async function yahooFetch(accessToken: string, path: string, errorLabel: string): Promise<unknown> {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Yahoo ${errorLabel} request failed: ${response.status} ${text}`)
  }

  return response.json()
}
