import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchMyMatchups } from './fetchMyMatchup.js'

describe('fetchMyMatchups', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the team matchups endpoint with a bearer token and format=json', async () => {
    const rawJson = { fantasy_content: { team: [] } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rawJson })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMyMatchups('access-token-123', '453.l.1.t.8')

    expect(result).toBe(rawJson)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://fantasysports.yahooapis.com/fantasy/v2/team/453.l.1.t.8/matchups?format=json')
    expect(init.headers['Authorization']).toBe('Bearer access-token-123')
  })

  it('throws with status on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
    )

    await expect(fetchMyMatchups('bad-token', '453.l.1.t.8')).rejects.toThrow(/401/)
  })
})
