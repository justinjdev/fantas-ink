// server/api/cron.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// matchup.ts is NOT mocked in this file - the real parseMatchups runs
// against whatever fetchMyMatchupsMock resolves to, same fixture shape as
// matchup.test.ts, so this can exercise the real degrade-together behavior
// rather than a mocked stand-in for it.
function makeMatchupTeam(teamKey: string, name: string, statValues: Record<string, string>) {
  return {
    team: [
      [{ team_key: teamKey }, { name }],
      { team_stats: { stats: Object.entries(statValues).map(([stat_id, value]) => ({ stat: { stat_id, value } })) } },
    ],
  }
}

function makeMatchup(week: number, status: string, myStats: Record<string, string>, theirStats: Record<string, string>) {
  return {
    matchup: {
      week: String(week),
      status,
      teams: {
        '0': { team: makeMatchupTeam('453.l.1.t.7', 'Cellar Dwellers', myStats).team },
        '1': { team: makeMatchupTeam('453.l.1.t.2', 'Puck Norris', theirStats).team },
        count: 2,
      },
    },
  }
}

function makeRawMatchups(matchups: Record<string, unknown>) {
  return {
    fantasy_content: {
      team: [
        [{ team_key: '453.l.1.t.7' }, { name: 'Cellar Dwellers' }],
        { matchups: { ...matchups, count: Object.keys(matchups).length } },
      ],
    },
  }
}

const getStoredRefreshTokenMock = vi.fn()
const setStoredRefreshTokenMock = vi.fn()
const setLatestStandingsMock = vi.fn()
const getCachedLeagueSettingsMock = vi.fn()
const setCachedLeagueSettingsMock = vi.fn()
vi.mock('../lib/storage.js', () => ({
  getStoredRefreshToken: (...a: unknown[]) => getStoredRefreshTokenMock(...a),
  setStoredRefreshToken: (...a: unknown[]) => setStoredRefreshTokenMock(...a),
  setLatestStandings: (...a: unknown[]) => setLatestStandingsMock(...a),
  getCachedLeagueSettings: (...a: unknown[]) => getCachedLeagueSettingsMock(...a),
  setCachedLeagueSettings: (...a: unknown[]) => setCachedLeagueSettingsMock(...a),
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
const parseAllTeamsMock = vi.fn()
const formatRecordMock = vi.fn()
vi.mock('../lib/transform.js', () => ({
  transformStandings: (...a: unknown[]) => transformStandingsMock(...a),
  parseAllTeams: (...a: unknown[]) => parseAllTeamsMock(...a),
  formatRecord: (...a: unknown[]) => formatRecordMock(...a),
}))

const fetchLeagueSettingsMock = vi.fn()
vi.mock('../lib/fetchLeagueSettings.js', () => ({
  fetchLeagueSettings: (...a: unknown[]) => fetchLeagueSettingsMock(...a),
}))

const fetchMyMatchupsMock = vi.fn()
vi.mock('../lib/fetchMyMatchup.js', () => ({
  fetchMyMatchups: (...a: unknown[]) => fetchMyMatchupsMock(...a),
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
    // Sane defaults so tests unrelated to settings/matchups don't exercise
    // the degrade-on-failure paths incidentally.
    getCachedLeagueSettingsMock.mockResolvedValue({ categories: [], playoffTeams: null })
    fetchMyMatchupsMock.mockResolvedValue({})
  })

  it('rejects requests without the correct CRON_SECRET bearer token', async () => {
    const req = { headers: {} } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(refreshAccessTokenMock).not.toHaveBeenCalled()
  })

  it('rejects "Bearer undefined" when CRON_SECRET is unset (fail closed, not open)', async () => {
    process.env.CRON_SECRET = undefined
    const req = { headers: { authorization: 'Bearer undefined' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(refreshAccessTokenMock).not.toHaveBeenCalled()
  })

  it('uses the stored refresh token when present, refreshes, fetches, transforms, and stores', async () => {
    getStoredRefreshTokenMock.mockResolvedValue('stored-refresh-token')
    refreshAccessTokenMock.mockResolvedValue({ accessToken: 'access-1', refreshToken: 'rotated-refresh', expiresIn: 3600 })
    fetchLeagueStandingsMock.mockResolvedValue({ raw: true })
    transformStandingsMock.mockReturnValue({ asOf: 'x', myTeamKey: '453.l.1.t.7', leagueName: 'Test League', rows: [] })

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
    transformStandingsMock.mockReturnValue({ asOf: 'x', myTeamKey: '453.l.1.t.7', leagueName: 'Test League', rows: [] })

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

  it('still publishes standings when the matchup fetch fails (matchups degrade independently)', async () => {
    getStoredRefreshTokenMock.mockResolvedValue('stored-refresh-token')
    refreshAccessTokenMock.mockResolvedValue({ accessToken: 'access-1', refreshToken: 'rotated-refresh', expiresIn: 3600 })
    fetchLeagueStandingsMock.mockResolvedValue({ raw: true })
    transformStandingsMock.mockReturnValue({
      asOf: 'x',
      myTeamKey: '453.l.1.t.7',
      leagueName: 'Test League',
      rows: [{ rank: 1, name: 'Cellar Dwellers', wins: 5, losses: 2, ties: 0, winPct: '.714', streak: 'W2', isMe: true }],
    })
    fetchMyMatchupsMock.mockRejectedValue(new Error('Yahoo matchups request failed: 500'))

    const req = { headers: { authorization: 'Bearer cron-secret' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(setLatestStandingsMock).toHaveBeenCalled()
    const written = setLatestStandingsMock.mock.calls[0][0]
    expect(written.currentMatchup).toBeNull()
    expect(written.lastMatchup).toBeNull()
    expect(written.nextMatchup).toBeNull()
    expect(written.rows).toHaveLength(1)
  })

  it('still publishes standings when the settings fetch fails on a cache miss', async () => {
    getStoredRefreshTokenMock.mockResolvedValue('stored-refresh-token')
    refreshAccessTokenMock.mockResolvedValue({ accessToken: 'access-1', refreshToken: 'rotated-refresh', expiresIn: 3600 })
    fetchLeagueStandingsMock.mockResolvedValue({ raw: true })
    transformStandingsMock.mockReturnValue({
      asOf: 'x',
      myTeamKey: '453.l.1.t.7',
      leagueName: 'Test League',
      rows: [{ rank: 1, name: 'Cellar Dwellers', wins: 5, losses: 2, ties: 0, winPct: '.714', streak: 'W2', isMe: true }],
    })
    getCachedLeagueSettingsMock.mockResolvedValue(null)
    fetchLeagueSettingsMock.mockRejectedValue(new Error('Yahoo league settings request failed: 500'))

    const req = { headers: { authorization: 'Bearer cron-secret' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(setLatestStandingsMock).toHaveBeenCalled()
    const written = setLatestStandingsMock.mock.calls[0][0]
    expect(written.playoffTeams).toBeNull()
    expect(written.rows).toHaveLength(1)
  })

  it('still publishes standings when the settings cache read fails', async () => {
    getStoredRefreshTokenMock.mockResolvedValue('stored-refresh-token')
    refreshAccessTokenMock.mockResolvedValue({ accessToken: 'access-1', refreshToken: 'rotated-refresh', expiresIn: 3600 })
    fetchLeagueStandingsMock.mockResolvedValue({ raw: true })
    transformStandingsMock.mockReturnValue({
      asOf: 'x',
      myTeamKey: '453.l.1.t.7',
      leagueName: 'Test League',
      rows: [{ rank: 1, name: 'Cellar Dwellers', wins: 5, losses: 2, ties: 0, winPct: '.714', streak: 'W2', isMe: true }],
    })
    getCachedLeagueSettingsMock.mockRejectedValue(new Error('blob service unavailable'))
    fetchLeagueSettingsMock.mockRejectedValue(new Error('Yahoo league settings request failed: 500'))

    const req = { headers: { authorization: 'Bearer cron-secret' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(setLatestStandingsMock).toHaveBeenCalled()
    const written = setLatestStandingsMock.mock.calls[0][0]
    expect(written.playoffTeams).toBeNull()
    expect(written.rows).toHaveLength(1)
  })

  it('nulls out currentMatchup and lastMatchup when categories are unavailable, even though the matchup fetch itself succeeded', async () => {
    getStoredRefreshTokenMock.mockResolvedValue('stored-refresh-token')
    refreshAccessTokenMock.mockResolvedValue({ accessToken: 'access-1', refreshToken: 'rotated-refresh', expiresIn: 3600 })
    fetchLeagueStandingsMock.mockResolvedValue({ raw: true })
    transformStandingsMock.mockReturnValue({
      asOf: 'x',
      myTeamKey: '453.l.1.t.7',
      leagueName: 'Test League',
      rows: [{ rank: 1, name: 'Cellar Dwellers', wins: 5, losses: 2, ties: 0, winPct: '.714', streak: 'W2', isMe: true }],
    })
    // Settings degrade to empty categories (cache miss + fetch failure), but
    // the matchup fetch succeeds with a real in-progress matchup - this is
    // exactly the state that used to fabricate TIED/0-0-0.
    getCachedLeagueSettingsMock.mockResolvedValue(null)
    fetchLeagueSettingsMock.mockRejectedValue(new Error('Yahoo league settings request failed: 500'))
    fetchMyMatchupsMock.mockResolvedValue(
      makeRawMatchups({ '0': makeMatchup(20, 'midevent', { '1': '14' }, { '1': '10' }) })
    )

    const req = { headers: { authorization: 'Bearer cron-secret' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const written = setLatestStandingsMock.mock.calls[0][0]
    expect(written.currentMatchup).toBeNull()
    expect(written.lastMatchup).toBeNull()
  })
})
