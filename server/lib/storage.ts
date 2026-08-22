// server/lib/storage.ts
import { put, head } from '@vercel/blob'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import type { StandingsPayload } from './transform.js'

const REFRESH_TOKEN_PATH = 'private/yahoo-refresh-token.json'
const STANDINGS_PATH = 'latest.json'
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is not set')
  return Buffer.from(key, 'base64')
}

// IV || authTag || ciphertext, base64-encoded as a single string.
function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

function decrypt(encoded: string): string {
  const data = Buffer.from(encoded, 'base64')
  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

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
  const data = await readJsonBlob<{ encryptedToken: string }>(REFRESH_TOKEN_PATH)
  return data ? decrypt(data.encryptedToken) : null
}

export async function setStoredRefreshToken(token: string): Promise<void> {
  await put(REFRESH_TOKEN_PATH, JSON.stringify({ encryptedToken: encrypt(token) }), {
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
