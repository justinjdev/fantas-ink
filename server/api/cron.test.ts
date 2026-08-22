// server/api/cron.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const getStoredRefreshTokenMock = vi.fn()
const setStoredRefreshTokenMock = vi.fn()
const setLatestStandingsMock = vi.fn()
vi.mock('../lib/storage.js', () => ({
  getStoredRefreshToken: (...a: unknown[]) => getStoredRefreshTokenMock(...a),
  setStoredRefreshToken: (...a: unknown[]) => setStoredRefreshTokenMock(...a),
  setLatestStandings: (...a: unknown[]) => setLatestStandingsMock(...a),
}))

const refreshAccessTokenMock = vi.fn()
vi.mock('../lib/yahoo.js', () => ({
  refreshAccessToken: (...a: unknown[]) => refreshAccessTokenMock(...a),
}))

const fetchLeagueStandingsMock = vi.fn()
vi.mock('../lib/fetchStandings.js', () => ({
  fetchLeagueStandings: (...a: unknown[]) => fetchLeagueStandingsMock(...a),
}))

const transformStandingsMock = vi.fn()
vi.mock('../lib/transform.js', () => ({
  transformStandings: (...a: unknown[]) => transformStandingsMock(...a),
}))

const handler = (await import('./cron.js')).default

function mockRes(): VercelResponse {
  const res = {} as VercelResponse
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

describe('GET /api/cron', () => {
  const OLD_ENV = process.env
  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...OLD_ENV,
      CRON_SECRET: 'cron-secret',
      YAHOO_CLIENT_ID: 'client-id',
      YAHOO_CLIENT_SECRET: 'client-secret',
      YAHOO_REDIRECT_URI: 'https://example.com/callback',
      YAHOO_INITIAL_REFRESH_TOKEN: 'bootstrap-refresh-token',
      YAHOO_LEAGUE_KEY: '453.l.1',
      YAHOO_MY_TEAM_KEY: '453.l.1.t.7',
    }
  })

  it('rejects requests without the correct CRON_SECRET bearer token', async () => {
    const req = { headers: {} } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(refreshAccessTokenMock).not.toHaveBeenCalled()
  })

  it('uses the stored refresh token when present, refreshes, fetches, transforms, and stores', async () => {
    getStoredRefreshTokenMock.mockResolvedValue('stored-refresh-token')
    refreshAccessTokenMock.mockResolvedValue({ accessToken: 'access-1', refreshToken: 'rotated-refresh', expiresIn: 3600 })
    fetchLeagueStandingsMock.mockResolvedValue({ raw: true })
    transformStandingsMock.mockReturnValue({ asOf: 'x', myTeamKey: '453.l.1.t.7', rows: [] })

    const req = { headers: { authorization: 'Bearer cron-secret' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(refreshAccessTokenMock).toHaveBeenCalledWith('stored-refresh-token', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
    })
    expect(setStoredRefreshTokenMock).toHaveBeenCalledWith('rotated-refresh')
    expect(fetchLeagueStandingsMock).toHaveBeenCalledWith('access-1', '453.l.1')
    expect(transformStandingsMock).toHaveBeenCalledWith({ raw: true }, '453.l.1.t.7', expect.any(String))
    expect(setLatestStandingsMock).toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('falls back to YAHOO_INITIAL_REFRESH_TOKEN when no token is stored yet', async () => {
    getStoredRefreshTokenMock.mockResolvedValue(null)
    refreshAccessTokenMock.mockResolvedValue({ accessToken: 'access-1', refreshToken: 'rotated-refresh', expiresIn: 3600 })
    fetchLeagueStandingsMock.mockResolvedValue({ raw: true })
    transformStandingsMock.mockReturnValue({ asOf: 'x', myTeamKey: '453.l.1.t.7', rows: [] })

    const req = { headers: { authorization: 'Bearer cron-secret' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(refreshAccessTokenMock).toHaveBeenCalledWith('bootstrap-refresh-token', expect.anything())
  })

  it('returns 500 and does not overwrite stored standings when the Yahoo fetch fails', async () => {
    getStoredRefreshTokenMock.mockResolvedValue('stored-refresh-token')
    refreshAccessTokenMock.mockResolvedValue({ accessToken: 'access-1', refreshToken: 'rotated-refresh', expiresIn: 3600 })
    fetchLeagueStandingsMock.mockRejectedValue(new Error('Yahoo standings request failed: 500'))

    const req = { headers: { authorization: 'Bearer cron-secret' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(setLatestStandingsMock).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(500)
  })
})
