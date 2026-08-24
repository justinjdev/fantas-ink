import { YAHOO_TIMEOUT_MS } from './yahooFetch.js'

const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token'

export interface YahooTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

interface YahooEnv {
  clientId: string
  clientSecret: string
  redirectUri: string
}

interface RawTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

async function postToken(body: URLSearchParams, env: YahooEnv): Promise<YahooTokens> {
  const basicAuth = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString('base64')

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Yahoo token request failed: ${response.status} ${text}`)
  }

  const raw = (await response.json()) as RawTokenResponse
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresIn: raw.expires_in,
  }
}

export function refreshAccessToken(refreshToken: string, env: YahooEnv): Promise<YahooTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    redirect_uri: env.redirectUri,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  })
  return postToken(body, env)
}

export function exchangeCodeForTokens(code: string, env: YahooEnv): Promise<YahooTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.redirectUri,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  })
  return postToken(body, env)
}

export function buildAuthorizeUrl(env: Pick<YahooEnv, 'clientId' | 'redirectUri'>): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: 'code',
    language: 'en-us',
  })
  return `https://api.login.yahoo.com/oauth2/request_auth?${params.toString()}`
}
