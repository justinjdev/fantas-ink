import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const getLatestStandingsMock = vi.fn()
vi.mock('../lib/storage.js', () => ({
  getLatestStandings: (...args: unknown[]) => getLatestStandingsMock(...args),
}))

const handler = (await import('./standings.js')).default

function mockRes(): VercelResponse {
  const res = {} as VercelResponse
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

describe('GET /api/standings', () => {
  const OLD_ENV = process.env
  beforeEach(() => {
    getLatestStandingsMock.mockReset()
    process.env = { ...OLD_ENV, SHARED_TOKEN: 'secret-token' }
  })

  it('returns 401 when the token query param is missing or wrong', async () => {
    const req = { query: { token: 'wrong' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 200 with the stored payload when the token matches', async () => {
    const payload = { asOf: '2026-08-21T11:55:00Z', myTeamKey: 't.1', rows: [] }
    getLatestStandingsMock.mockResolvedValue(payload)
    const req = { query: { token: 'secret-token' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(payload)
  })

  it('returns 503 when no standings have been written yet', async () => {
    getLatestStandingsMock.mockResolvedValue(null)
    const req = { query: { token: 'secret-token' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(503)
  })
})
