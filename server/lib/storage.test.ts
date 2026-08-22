// server/lib/storage.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const putMock = vi.fn()
const headMock = vi.fn()

vi.mock('@vercel/blob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vercel/blob')>()
  return {
    ...actual,
    put: (...args: unknown[]) => putMock(...args),
    head: (...args: unknown[]) => headMock(...args),
  }
})

// Imported after the mock so storage.ts picks up the mocked module.
const { BlobNotFoundError } = await import('@vercel/blob')
const { getStoredRefreshToken, setStoredRefreshToken, getLatestStandings, setLatestStandings } =
  await import('./storage.js')

describe('refresh token storage', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    putMock.mockReset()
    headMock.mockReset()
    // Fixed 32-byte test key, base64-encoded — same shape as a real TOKEN_ENCRYPTION_KEY.
    process.env = { ...OLD_ENV, TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  it('setStoredRefreshToken writes an encrypted, non-cached JSON blob (never the raw token)', async () => {
    await setStoredRefreshToken('abc123')

    expect(putMock).toHaveBeenCalledTimes(1)
    const [pathname, body, options] = putMock.mock.calls[0]
    expect(pathname).toBe('private/yahoo-refresh-token.json')
    expect(body).not.toContain('abc123')
    expect(options).toMatchObject({
      access: 'public',
      contentType: 'application/json',
      cacheControlMaxAge: 60,
      addRandomSuffix: false,
    })
  })

  it('getStoredRefreshToken decrypts the stored blob back to the original token', async () => {
    let storedBody = ''
    putMock.mockImplementation((_pathname: string, body: string) => {
      storedBody = body
    })
    headMock.mockResolvedValue({ url: 'https://blob.example/private/yahoo-refresh-token.json' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => ({ ok: true, json: async () => JSON.parse(storedBody) }))
    )

    await setStoredRefreshToken('abc123')
    const result = await getStoredRefreshToken()

    expect(result).toBe('abc123')
  })

  it('getStoredRefreshToken returns null if the blob does not exist yet', async () => {
    headMock.mockRejectedValue(new BlobNotFoundError())

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
      expect.objectContaining({
        access: 'public',
        contentType: 'application/json',
        cacheControlMaxAge: 60,
        addRandomSuffix: false,
      })
    )
  })

  it('getLatestStandings returns null if not yet written', async () => {
    headMock.mockRejectedValue(new BlobNotFoundError())

    const result = await getLatestStandings()

    expect(result).toBeNull()
  })
})
