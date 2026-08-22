import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchLeagueStandings } from './fetchStandings.js'

describe('fetchLeagueStandings', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the league standings endpoint with a bearer token and format=json', async () => {
    const rawJson = { fantasy_content: { league: [] } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rawJson })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchLeagueStandings('access-token-123', '453.l.1')

    expect(result).toBe(rawJson)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://fantasysports.yahooapis.com/fantasy/v2/league/453.l.1/standings?format=json')
    expect(init.headers['Authorization']).toBe('Bearer access-token-123')
  })

  it('throws with status on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
    )

    await expect(fetchLeagueStandings('bad-token', '453.l.1')).rejects.toThrow(/401/)
  })
})
