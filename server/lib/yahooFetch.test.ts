import { describe, it, expect, vi, beforeEach } from 'vitest'
import { yahooFetch } from './yahooFetch.js'

describe('yahooFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('builds the URL from the base and path, with a bearer token', async () => {
    const rawJson = { ok: true }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rawJson })
    vi.stubGlobal('fetch', fetchMock)

    const result = await yahooFetch('access-token-123', '/league/453.l.1/standings?format=json', 'standings')

    expect(result).toBe(rawJson)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://fantasysports.yahooapis.com/fantasy/v2/league/453.l.1/standings?format=json')
    expect(init.headers['Authorization']).toBe('Bearer access-token-123')
  })

  it('throws with the label and status on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
    )

    await expect(yahooFetch('bad-token', '/league/453.l.1/settings?format=json', 'league settings')).rejects.toThrow(
      /Yahoo league settings request failed: 401/
    )
  })

  it('passes an AbortSignal so a hung connection cannot run indefinitely', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await yahooFetch('access-token-123', '/team/453.l.1.t.7/matchups?format=json', 'matchups')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('propagates an abort/timeout failure rather than swallowing it', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    await expect(yahooFetch('access-token-123', '/league/453.l.1/standings?format=json', 'standings')).rejects.toBe(
      abortError
    )
  })
})
