// server/lib/yahoo.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { refreshAccessToken, exchangeCodeForTokens } from './yahoo.js'

const ENV = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://example.com/callback',
}

describe('refreshAccessToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('posts to the Yahoo token endpoint with Basic auth and refresh_token grant', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        token_type: 'bearer',
        expires_in: 3600,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await refreshAccessToken('old-refresh-token', ENV)

    expect(result).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.login.yahoo.com/oauth2/get_token')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe(
      `Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`
    )
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')

    const body = new URLSearchParams(init.body)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('old-refresh-token')
    expect(body.get('redirect_uri')).toBe(ENV.redirectUri)
    expect(body.get('client_id')).toBe(ENV.clientId)
    expect(body.get('client_secret')).toBe(ENV.clientSecret)
  })

  it('throws with the response body on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid_grant',
      })
    )

    await expect(refreshAccessToken('bad-token', ENV)).rejects.toThrow(/401/)
  })
})

describe('exchangeCodeForTokens', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('posts with grant_type=authorization_code and the given code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'first-access',
        refresh_token: 'first-refresh',
        token_type: 'bearer',
        expires_in: 3600,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await exchangeCodeForTokens('auth-code-123', ENV)

    expect(result).toEqual({
      accessToken: 'first-access',
      refreshToken: 'first-refresh',
      expiresIn: 3600,
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = new URLSearchParams(init.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code-123')
  })
})
