// server/lib/storage.ts
import { put, head } from '@vercel/blob'
import type { StandingsPayload } from './transform.js'

const REFRESH_TOKEN_PATH = 'private/yahoo-refresh-token.json'
const STANDINGS_PATH = 'latest.json'

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 404
}

async function readJsonBlob<T>(pathname: string): Promise<T | null> {
  try {
    const blob = await head(pathname)
    const response = await fetch(blob.url)
    if (!response.ok) return null
    return (await response.json()) as T
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function getStoredRefreshToken(): Promise<string | null> {
  const data = await readJsonBlob<{ refreshToken: string }>(REFRESH_TOKEN_PATH)
  return data?.refreshToken ?? null
}

export async function setStoredRefreshToken(token: string): Promise<void> {
  await put(REFRESH_TOKEN_PATH, JSON.stringify({ refreshToken: token }), {
    access: 'public',
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  })
}

export async function getLatestStandings(): Promise<StandingsPayload | null> {
  return readJsonBlob<StandingsPayload>(STANDINGS_PATH)
}

export async function setLatestStandings(payload: StandingsPayload): Promise<void> {
  await put(STANDINGS_PATH, JSON.stringify(payload), {
    access: 'public',
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  })
}
