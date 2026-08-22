// server/lib/storage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const putMock = vi.fn()
const headMock = vi.fn()

vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => putMock(...args),
  head: (...args: unknown[]) => headMock(...args),
}))

// Imported after the mock so storage.ts picks up the mocked module.
const { getStoredRefreshToken, setStoredRefreshToken, getLatestStandings, setLatestStandings } =
  await import('./storage.js')

describe('refresh token storage', () => {
  beforeEach(() => {
    putMock.mockReset()
    headMock.mockReset()
  })

  it('setStoredRefreshToken writes a private, non-cached JSON blob', async () => {
    await setStoredRefreshToken('abc123')

    expect(putMock).toHaveBeenCalledWith(
      'private/yahoo-refresh-token.json',
      JSON.stringify({ refreshToken: 'abc123' }),
      expect.objectContaining({ access: 'public', contentType: 'application/json', cacheControlMaxAge: 0 })
    )
  })

  it('getStoredRefreshToken fetches the blob URL and parses it', async () => {
    headMock.mockResolvedValue({ url: 'https://blob.example/private/yahoo-refresh-token.json' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ refreshToken: 'abc123' }) })
    )

    const result = await getStoredRefreshToken()

    expect(result).toBe('abc123')
  })

  it('getStoredRefreshToken returns null if the blob does not exist yet', async () => {
    headMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))

    const result = await getStoredRefreshToken()

    expect(result).toBeNull()
  })
})

describe('standings storage', () => {
  beforeEach(() => {
    putMock.mockReset()
    headMock.mockReset()
  })

  const payload = {
    asOf: '2026-08-21T11:55:00Z',
    myTeamKey: '453.l.1.t.7',
    rows: [{ rank: 1, name: 'Team A', wins: 10, losses: 2, ties: 0 }],
  }

  it('setLatestStandings writes latest.json publicly', async () => {
    await setLatestStandings(payload)

    expect(putMock).toHaveBeenCalledWith(
      'latest.json',
      JSON.stringify(payload),
      expect.objectContaining({ access: 'public', contentType: 'application/json' })
    )
  })

  it('getLatestStandings returns null if not yet written', async () => {
    headMock.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))

    const result = await getLatestStandings()

    expect(result).toBeNull()
  })
})
