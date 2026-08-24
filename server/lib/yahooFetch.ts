const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2'

// A hung Yahoo connection with no timeout can burn a serverless function's
// entire budget, defeating the "degrade gracefully" goal for every field in
// the payload, not just the one that was fetching - every Yahoo call goes
// through here so none of them can do that.
const TIMEOUT_MS = 10000

export async function yahooFetch(accessToken: string, path: string, errorLabel: string): Promise<unknown> {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Yahoo ${errorLabel} request failed: ${response.status} ${text}`)
  }

  return response.json()
}
