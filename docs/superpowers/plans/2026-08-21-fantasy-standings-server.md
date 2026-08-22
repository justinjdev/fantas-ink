# Fantasy Standings Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Vercel companion service that refreshes Yahoo OAuth tokens, fetches Fantasy Hockey league standings once a day, transforms them into the fixed view-model contract, and serves them to the ESP32 without the device ever touching Yahoo directly.

**Architecture:** Two Vercel serverless functions (`api/cron.ts`, `api/standings.ts`) backed by shared library modules (`lib/yahoo.ts`, `lib/transform.ts`, `lib/storage.ts`, `lib/fetchStandings.ts`) and Vercel Blob for state. A one-time interactive CLI script (`scripts/setup-yahoo-auth.ts`) handles the OAuth authorization-code exchange and league/team discovery that can't be automated (needs a human in a browser).

**Tech Stack:** TypeScript, `@vercel/node` (standalone serverless functions, no Next.js needed), `@vercel/blob`, Vitest for unit tests, Node 20 runtime.

## Global Constraints

- The public `GET /api/standings` endpoint must never call Yahoo live — it only reads the last value `api/cron.ts` wrote to Blob. (From spec: "ESP32 never blocks on OAuth latency.")
- `api/cron.ts` must only run on Vercel's actual Cron trigger, verified via the `CRON_SECRET` bearer token Vercel sends — not open to arbitrary callers, since it drives Yahoo token rotation.
- Yahoo rotates the refresh token on every use — the *current* refresh token must be persisted in Blob (private, not the public `latest.json`) after every successful refresh, since Vercel env vars can't be updated at runtime. The env var `YAHOO_INITIAL_REFRESH_TOKEN` is only a one-time bootstrap fallback.
- Data contract for `latest.json` is fixed by the design spec (`docs/superpowers/specs/2026-08-21-fantasy-hockey-eink-scoreboard-design.md`): `{ asOf, myTeamKey, rows: [{rank, name, wins, losses, ties, isMe?} | {gap: true}] }`, where `rows` = top 3 ∪ (myRank − 2 .. myRank + 2), deduplicated, sorted by rank ascending, with a `{gap: true}` divider where the two ranges don't overlap.
- Yahoo's JSON responses represent arrays as objects with stringified numeric keys (e.g. `{"0": {...}, "1": {...}, "count": N}`) plus positionally-inconsistent nesting (confirmed via `yahoo_fantasy_api` library source and Yahoo's own docs during design research) — all Yahoo response parsing must search by key name, never by fixed array index.
- Per spec: only `lib/transform.ts` needs thorough unit test coverage; it's "the one place with real logic worth covering." Other modules get enough tests to verify request construction and error handling, not exhaustive coverage.

## Post-Implementation Fixes (Final Whole-Branch Review)

The task-by-task sections below reflect the plan as originally written and executed. A final review after all 9 tasks landed found three integration-level bugs no task-scoped review could see (each task's mocked tests were individually correct but didn't match the real `@vercel/blob` library's actual behavior, or didn't get a fix that had already landed in a sibling file). These were fixed in one consolidated pass; task sections were not individually rewritten to match — this section is the accurate record instead.

- **`server/lib/storage.ts`:** both `put()` calls (refresh token and standings) now pass `addRandomSuffix: false`. Without it, `@vercel/blob@0.27.x` appends a random suffix to every write by default, so nothing written was ever findable via `head()` — the storage layer was non-functional end-to-end despite all mocked tests passing. `isNotFound()` now checks `err instanceof BlobNotFoundError` (imported from `@vercel/blob`) as its primary check — the real error the library throws has no `status` property, so the original `'status' in err` check never matched and "not found" was rethrown instead of returning `null`, breaking both the cron bootstrap fallback and `/api/standings`'s 503 path. `getEncryptionKey()` now validates the decoded `TOKEN_ENCRYPTION_KEY` is exactly 32 bytes, throwing a clear error rather than letting `createCipheriv` fail with an opaque one. `storage.test.ts`'s "not found" tests now reject with a real `new BlobNotFoundError()` (via a partial `vi.mock` that imports the real module and only overrides `put`/`head`) instead of a fabricated `{status: 404}` object, so the fix is actually locked in by the suite.
- **New file `server/lib/safeCompare.ts`:** `timingSafeStringEqual(a: string, b: string): boolean` — guards equal length before calling `node:crypto`'s `timingSafeEqual` (which throws on length mismatch), used by both auth checks below.
- **`server/api/cron.ts`:** the `CRON_SECRET` auth check now fails closed (`!process.env.CRON_SECRET || !timingSafeStringEqual(...)`) instead of `authHeader !== \`Bearer ${process.env.CRON_SECRET}\``, which was fail-open when `CRON_SECRET` was unset (an attacker sending the literal header `Bearer undefined` would pass) — the same class of bug already found and fixed in `api/standings.ts` during Task 6's review, but never propagated to this sibling file.
- **`server/api/standings.ts`:** the `SHARED_TOKEN` check now also uses `timingSafeStringEqual` (coercing a non-string `req.query.token` to `''` first). `getLatestStandings()` is now wrapped in try/catch, returning 503 (same body as "no data yet") on any storage error instead of an unhandled 500.
- **New file `server/.vercelignore`:** `*.test.ts` — without it, Vercel's zero-config function detection would deploy `api/cron.test.ts` and `api/standings.test.ts` as public functions.
- **`server/README.md`:** setup steps now add `--env-file=.env.local` to the `tsx` invocation (nothing previously loaded the pulled env file into the script's process), list `BLOB_READ_WRITE_TOKEN` as required locally (the setup script writes to Blob), and note the Vercel project's Root Directory must be set to `server`.

**Post-PR-review round (Copilot):** three more findings caught after the branch was pushed:
- **`server/lib/storage.ts`:** both `put()` calls used `cacheControlMaxAge: 0`; Vercel Blob enforces a 60-second minimum, so this was likely rejected server-side, meaning every write could fail outright. Now `cacheControlMaxAge: 60` (a `MIN_CACHE_CONTROL_MAX_AGE` constant), harmless given data changes at most once a day. `storage.test.ts` now asserts `cacheControlMaxAge: 60` and `addRandomSuffix: false` on both the refresh-token and standings write tests (previously only partially asserted, so a regression on either option wouldn't have been caught).
- **`server/scripts/setup-yahoo-auth.ts`:** the entry-point check `import.meta.url === \`file://${process.argv[1]}\`` compared a percent-encoded URL against a raw filesystem path — false on Windows or paths containing spaces, silently no-op-ing the documented setup command. Now uses `pathToFileURL(process.argv[1]).href` from `node:url`.

**Post-deployment-attempt round:** discovered while actually setting up the Vercel project (the deployment/verification step this whole plan kept flagging as unrun — this is exactly the class of bug it warned about):
- **Vercel Blob no longer injects `BLOB_READ_WRITE_TOKEN`** when a store is connected to a project — only `BLOB_STORE_ID` and `VERCEL_OIDC_TOKEN` (OIDC-based auth). The plan's pinned `@vercel/blob@^0.27.0` predates OIDC support entirely and only knows how to read `BLOB_READ_WRITE_TOKEN`, so it would have thrown "No token found" on every real request despite passing all mocked tests. Upgraded to `^2.8.0`, which supports OIDC via `BLOB_STORE_ID`/`VERCEL_OIDC_TOKEN` automatically, with no code changes needed in `storage.ts` — same `put()`/`head()`/`BlobNotFoundError` API surface. Verified: 31/31 tests still pass, `tsc --noEmit` clean.
- **`@vercel/node@^3.2.0` was also two major versions stale** (latest at time of setup: `5.10.2`), pulling in transitive dependencies with several `npm audit`-flagged vulnerabilities (ajv, esbuild, path-to-regexp, tar). Upgraded to `^5.10.2`, which resolved most of them; residual `undici` advisories are nested inside `@vercel/node`'s own internal CLI/dev-server tooling, which the deployed app never executes (only its TypeScript types are used, at `import type` level).
- **`@types/node` was never a direct dependency** — it worked by accident via a transitive hoist from the old `@vercel/node`, and broke (`tsc` error TS2688: "Cannot find type definition file for 'node'") once that hoist path changed with the upgrade. Added `@types/node@^20.11.0` as an explicit devDependency, which is what it should have been from Task 1.
- **`README.md`'s setup steps updated** to match: `BLOB_READ_WRITE_TOKEN` references replaced with the Blob-store-connect step (Storage tab → Connect Project) that actually provisions `BLOB_STORE_ID`/`VERCEL_OIDC_TOKEN`; added a note that Yahoo's redirect URI field rejects the literal string `oob` (needs a real-looking HTTPS URL that never needs to resolve); added the separate Fantasy Sports API access-request step at `sports.yahoo.com/developer/access/`, discovered when the Yahoo app registration form no longer had a "Fantasy Sports" permission checkbox — Yahoo gated this behind manual review sometime around May 2026.

---

### Task 1: Project scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/vercel.json`
- Create: `server/.gitignore`

**Interfaces:**
- Produces: a `server/` directory where `npm install`, `npm test`, and `npx tsc --noEmit` all run cleanly, ready for later tasks to add source files.

- [ ] **Step 1: Write `server/package.json`**

```json
{
  "name": "fantasy-standings-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vercel/blob": "^0.27.0",
    "@vercel/node": "^3.2.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["api", "lib", "scripts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Write `server/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Write `server/vercel.json` (crons filled in by Task 9)**

```json
{
  "crons": []
}
```

- [ ] **Step 5: Write `server/.gitignore`**

```
node_modules/
.vercel/
.env
.env.local
dist/
```

- [ ] **Step 6: Install dependencies**

Run: `cd server && npm install`
Expected: installs cleanly, creates `package-lock.json`.

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/package-lock.json server/tsconfig.json server/vitest.config.ts server/vercel.json server/.gitignore
git commit -m "chore: scaffold server project"
```

---

### Task 2: Yahoo OAuth token client

**Files:**
- Create: `server/lib/yahoo.ts`
- Test: `server/lib/yahoo.test.ts`

**Interfaces:**
- Produces:
  - `interface YahooTokens { accessToken: string; refreshToken: string; expiresIn: number }`
  - `refreshAccessToken(refreshToken: string, env: { clientId: string; clientSecret: string; redirectUri: string }): Promise<YahooTokens>`
  - `exchangeCodeForTokens(code: string, env: { clientId: string; clientSecret: string; redirectUri: string }): Promise<YahooTokens>`
- Consumes: global `fetch` (Node 20 built-in).

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/yahoo.test.ts`
Expected: FAIL — `lib/yahoo.ts` does not exist / export not found.

- [ ] **Step 3: Write the implementation**

```typescript
// server/lib/yahoo.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/yahoo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/yahoo.ts server/lib/yahoo.test.ts
git commit -m "feat: add Yahoo OAuth token client"
```

---

### Task 3: Blob storage helpers

**Files:**
- Create: `server/lib/storage.ts`
- Test: `server/lib/storage.test.ts`

**Interfaces:**
- Consumes: `@vercel/blob`'s `put`, `head` functions (mocked in tests); Node's built-in `node:crypto`.
- Produces:
  - `getStoredRefreshToken(): Promise<string | null>`
  - `setStoredRefreshToken(token: string): Promise<void>`
  - `getLatestStandings(): Promise<StandingsPayload | null>` (uses the `StandingsPayload` type from Task 4, imported as a type-only import to avoid a circular runtime dependency)
  - `setLatestStandings(payload: StandingsPayload): Promise<void>`
- Blob pathnames: refresh token at `private/yahoo-refresh-token.json`, standings at `latest.json` (public, this is what `api/standings.ts` serves).
- **Security correction (found during implementation, not in the original spec):** Vercel Blob has no true private/access-controlled mode — `put()`'s `access` option only accepts `'public'`. The only protection on a `'public'` blob is an unguessable random suffix Vercel appends to the URL by default; that's not enough for a live Yahoo OAuth refresh token; if the URL ever leaks (logs, dashboard, error reporting), the token is readable by anyone with the link, no auth required. So the refresh token blob's *content* is now AES-256-GCM encrypted before it's written, using a key from a new env var `TOKEN_ENCRYPTION_KEY` (base64-encoded 32 bytes, e.g. generated with `openssl rand -base64 32`). The standings blob is unaffected — it's meant to be publicly readable by the ESP32.

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/storage.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
    expect(options).toMatchObject({ access: 'public', contentType: 'application/json', cacheControlMaxAge: 0 })
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/storage.test.ts`
Expected: FAIL — `lib/storage.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/storage.test.ts`
Expected: PASS (5 tests).

Note: `getLatestStandings`/`setLatestStandings` reference `StandingsPayload` from `lib/transform.ts`, which doesn't exist until Task 4. Add a minimal placeholder export in this task so the type-checks pass, to be filled in fully by Task 4:

```typescript
// server/lib/transform.ts (placeholder — Task 4 replaces this file's contents)
export interface StandingsPayload {
  asOf: string
  myTeamKey: string
  rows: StandingsRow[]
}

export type StandingsRow =
  | { rank: number; name: string; wins: number; losses: number; ties: number; isMe?: true }
  | { gap: true }
```

- [ ] **Step 5: Commit**

```bash
git add server/lib/storage.ts server/lib/storage.test.ts server/lib/transform.ts
git commit -m "feat: add Blob storage helpers for refresh token and standings"
```

---

### Task 4: Standings transform (top-3 + neighborhood windowing)

**Files:**
- Create: `server/lib/yahooJson.ts`
- Test: `server/lib/yahooJson.test.ts`
- Modify: `server/lib/transform.ts` (replaces Task 3's placeholder)
- Test: `server/lib/transform.test.ts`

**Interfaces:**
- Consumes: nothing external — pure functions.
- Produces:
  - `findByKey(node: unknown, key: string): unknown` and `numberedEntries(container: Record<string, unknown>): unknown[]` from `server/lib/yahooJson.ts` — shared Yahoo JSON-navigation helpers. Task 8's setup script also imports these; do not duplicate them there.
  - `StandingsPayload` (as declared in Task 3, kept identical)
  - `transformStandings(rawYahooJson: unknown, myTeamKey: string, asOf: string): StandingsPayload`

This is the module the spec calls out as needing thorough coverage — test the windowing/dedup/gap logic across boundary cases, not just the happy path.

- [ ] **Step 1: Write the failing test for the shared JSON-navigation helpers**

```typescript
// server/lib/yahooJson.test.ts
import { describe, it, expect } from 'vitest'
import { findByKey, numberedEntries } from './yahooJson.js'

describe('findByKey', () => {
  it('finds a key nested inside arrays and objects at any depth', () => {
    const node = [{}, { a: [{ b: { target: 'found' } }] }]
    expect(findByKey(node, 'target')).toBe('found')
  })

  it('returns undefined when the key is absent', () => {
    expect(findByKey({ a: { b: 1 } }, 'missing')).toBeUndefined()
  })
})

describe('numberedEntries', () => {
  it('returns the numbered values and excludes the sibling "count" key', () => {
    const container = { '0': 'a', '1': 'b', count: 2 }
    expect(numberedEntries(container)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/yahooJson.test.ts`
Expected: FAIL — `lib/yahooJson.ts` does not exist.

- [ ] **Step 3: Write the shared helpers implementation**

```typescript
// server/lib/yahooJson.ts
// Yahoo's JSON represents arrays as objects with stringified numeric keys plus
// a sibling "count" key, with inconsistent nesting depth. These helpers search
// by key name rather than assuming fixed positions or depths. Shared by
// lib/transform.ts and scripts/setup-yahoo-auth.ts — do not duplicate.
export function numberedEntries(container: Record<string, unknown>): unknown[] {
  const entries: unknown[] = []
  for (const [key, value] of Object.entries(container)) {
    if (key === 'count') continue
    entries.push(value)
  }
  return entries
}

export function findByKey(node: unknown, key: string): unknown {
  if (node === null || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findByKey(item, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  const record = node as Record<string, unknown>
  if (key in record) return record[key]
  for (const value of Object.values(record)) {
    const found = findByKey(value, key)
    if (found !== undefined) return found
  }
  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/yahooJson.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing tests for the transform**

```typescript
// server/lib/transform.test.ts
import { describe, it, expect } from 'vitest'
import { transformStandings } from './transform.js'

function makeTeam(rank: number, teamKey: string, wins: number, losses: number, ties = 0) {
  return {
    team: [
      [{ team_key: teamKey }, { name: `Team ${rank}` }],
      {
        team_standings: {
          rank,
          outcome_totals: { wins: String(wins), losses: String(losses), ties: String(ties) },
        },
      },
    ],
  }
}

function makeRawStandings(teamCount: number) {
  const teams: Record<string, unknown> = { count: teamCount }
  for (let i = 1; i <= teamCount; i++) {
    // Wins descend with rank so rank order is unambiguous in the fixture.
    teams[String(i - 1)] = makeTeam(i, `453.l.1.t.${i}`, teamCount - i, i - 1)
  }
  return {
    fantasy_content: {
      league: [
        { league_key: '453.l.1', name: 'Test League' },
        { standings: [{ teams }] },
      ],
    },
  }
}

describe('transformStandings', () => {
  const ASOF = '2026-08-21T11:55:00Z'

  it('includes top 3 and my rank +/-2 with a gap divider when they do not overlap (myRank=8 of 16)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.8', ASOF)

    expect(result.asOf).toBe(ASOF)
    expect(result.myTeamKey).toBe('453.l.1.t.8')

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 'gap', 6, 7, 8, 9, 10])

    const me = result.rows.find((r) => 'rank' in r && r.rank === 8)
    expect(me).toMatchObject({ isMe: true })
    const notMe = result.rows.find((r) => 'rank' in r && r.rank === 1)
    expect(notMe).not.toHaveProperty('isMe')
  })

  it('does not insert a gap when top 3 and the neighborhood window are adjacent or overlapping (myRank=4)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.4', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6])
    expect(ranks).not.toContain('gap')
  })

  it('does not insert a gap when the window fully contains the top 3 (myRank=2)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.2', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 4])
  })

  it('clamps the window at the bottom of the league (myRank=16 of 16)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.16', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 'gap', 14, 15, 16])
  })

  it('clamps the window at the top of the league (myRank=1)', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.1', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3])
  })

  it('extracts wins/losses/ties from outcome_totals as numbers', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.8', ASOF)

    const rankOne = result.rows.find((r) => 'rank' in r && r.rank === 1)
    expect(rankOne).toMatchObject({ wins: 15, losses: 0, ties: 0 })
  })

  it('handles a small league where top 3 and window cover everyone (8 teams, myRank=5)', () => {
    const raw = makeRawStandings(8)
    const result = transformStandings(raw, '453.l.1.t.5', ASOF)

    const ranks = result.rows.map((r) => ('gap' in r ? 'gap' : r.rank))
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: FAIL — `transformStandings` not exported (only the placeholder type exists).

- [ ] **Step 7: Write the implementation**

```typescript
// server/lib/transform.ts
import { findByKey, numberedEntries } from './yahooJson.js'

export interface StandingsPayload {
  asOf: string
  myTeamKey: string
  rows: StandingsRow[]
}

export type StandingsRow =
  | { rank: number; name: string; wins: number; losses: number; ties: number; isMe?: true }
  | { gap: true }

interface ParsedTeam {
  teamKey: string
  name: string
  rank: number
  wins: number
  losses: number
  ties: number
}

function parseTeam(rawTeamWrapper: unknown): ParsedTeam {
  const teamArray = (rawTeamWrapper as { team: unknown[] }).team
  const teamKey = findByKey(teamArray, 'team_key') as string
  const name = findByKey(teamArray, 'name') as string
  const standings = findByKey(teamArray, 'team_standings') as {
    rank: number | string
    outcome_totals: { wins: string; losses: string; ties: string }
  }

  return {
    teamKey,
    name,
    rank: Number(standings.rank),
    wins: Number(standings.outcome_totals.wins),
    losses: Number(standings.outcome_totals.losses),
    ties: Number(standings.outcome_totals.ties),
  }
}

function parseAllTeams(rawYahooJson: unknown): ParsedTeam[] {
  const teamsContainer = findByKey(rawYahooJson, 'teams') as Record<string, unknown>
  return numberedEntries(teamsContainer)
    .map(parseTeam)
    .sort((a, b) => a.rank - b.rank)
}

export function transformStandings(rawYahooJson: unknown, myTeamKey: string, asOf: string): StandingsPayload {
  const teams = parseAllTeams(rawYahooJson)
  const myTeam = teams.find((t) => t.teamKey === myTeamKey)
  if (!myTeam) {
    throw new Error(`myTeamKey ${myTeamKey} not found in standings response`)
  }

  const topRanks = new Set([1, 2, 3])
  const windowStart = Math.max(1, myTeam.rank - 2)
  const windowEnd = Math.min(teams.length, myTeam.rank + 2)
  const windowRanks = new Set<number>()
  for (let r = windowStart; r <= windowEnd; r++) windowRanks.add(r)

  const includedRanks = [...new Set([...topRanks, ...windowRanks])]
    .filter((r) => r <= teams.length)
    .sort((a, b) => a - b)

  const rows: StandingsRow[] = []
  let previousRank: number | null = null
  for (const rank of includedRanks) {
    if (previousRank !== null && rank - previousRank > 1) {
      rows.push({ gap: true })
    }
    const team = teams.find((t) => t.rank === rank)!
    rows.push({
      rank: team.rank,
      name: team.name,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      ...(team.teamKey === myTeamKey ? { isMe: true as const } : {}),
    })
    previousRank = rank
  }

  return { asOf, myTeamKey, rows }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Commit**

```bash
git add server/lib/yahooJson.ts server/lib/yahooJson.test.ts server/lib/transform.ts server/lib/transform.test.ts
git commit -m "feat: add standings windowing/dedup transform"
```

---

### Task 5: Yahoo standings fetch

**Files:**
- Create: `server/lib/fetchStandings.ts`
- Test: `server/lib/fetchStandings.test.ts`

**Interfaces:**
- Consumes: global `fetch`.
- Produces: `fetchLeagueStandings(accessToken: string, leagueKey: string): Promise<unknown>` — returns the raw parsed JSON, left as `unknown` since `transform.ts` (Task 4) is responsible for interpreting its shape.

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/fetchStandings.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchLeagueStandings } from './fetchStandings.js'

describe('fetchLeagueStandings', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the league standings endpoint with a bearer token and format=json', async () => {
    const rawJson = { fantasy_content: { league: [] } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rawJson })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchLeagueStandings('access-token-123', '453.l.1')

    expect(result).toBe(rawJson)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://fantasysports.yahooapis.com/fantasy/v2/league/453.l.1/standings?format=json')
    expect(init.headers['Authorization']).toBe('Bearer access-token-123')
  })

  it('throws with status on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
    )

    await expect(fetchLeagueStandings('bad-token', '453.l.1')).rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/fetchStandings.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// server/lib/fetchStandings.ts
const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2'

export async function fetchLeagueStandings(accessToken: string, leagueKey: string): Promise<unknown> {
  const url = `${BASE_URL}/league/${leagueKey}/standings?format=json`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Yahoo standings request failed: ${response.status} ${text}`)
  }

  return response.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/fetchStandings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/fetchStandings.ts server/lib/fetchStandings.test.ts
git commit -m "feat: add Yahoo league standings fetch"
```

---

### Task 6: Public standings endpoint

**Files:**
- Create: `server/api/standings.ts`
- Test: `server/api/standings.test.ts`

**Interfaces:**
- Consumes: `getLatestStandings` from `lib/storage.ts` (Task 3), `StandingsPayload` type from `lib/transform.ts` (Task 4).
- Produces: default-exported `(req: VercelRequest, res: VercelResponse) => Promise<void>` handler, deployed by Vercel at `GET /api/standings`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/api/standings.test.ts
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

  it('returns 401 when SHARED_TOKEN is unconfigured, even with no token param (fail closed, not open)', async () => {
    process.env = { ...OLD_ENV, SHARED_TOKEN: undefined }
    const req = { query: {} } as unknown as VercelRequest
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run api/standings.test.ts`
Expected: FAIL — `api/standings.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// server/api/standings.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getLatestStandings } from '../lib/storage.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const token = req.query.token
  // Fail closed: an unconfigured SHARED_TOKEN must never make this endpoint
  // publicly readable. `undefined !== undefined` is false, so the equality
  // check alone isn't enough — require SHARED_TOKEN to actually be set.
  if (!process.env.SHARED_TOKEN || token !== process.env.SHARED_TOKEN) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const payload = await getLatestStandings()
  if (!payload) {
    res.status(503).json({ error: 'standings not yet available' })
    return
  }

  res.status(200).json(payload)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run api/standings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/api/standings.ts server/api/standings.test.ts
git commit -m "feat: add public GET /api/standings endpoint"
```

---

### Task 7: Cron orchestration endpoint

**Files:**
- Create: `server/api/cron.ts`
- Test: `server/api/cron.test.ts`

**Interfaces:**
- Consumes: `refreshAccessToken` (Task 2), `getStoredRefreshToken`/`setStoredRefreshToken`/`setLatestStandings` (Task 3), `transformStandings` (Task 4), `fetchLeagueStandings` (Task 5).
- Produces: default-exported handler deployed at `POST /api/cron` (Vercel Cron issues GET by default — this plan uses GET to match Vercel's default invocation, see step 3).
- Env vars consumed directly: `CRON_SECRET`, `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`, `YAHOO_INITIAL_REFRESH_TOKEN`, `YAHOO_LEAGUE_KEY`, `YAHOO_MY_TEAM_KEY`. Also indirectly requires `TOKEN_ENCRYPTION_KEY` to be set (consumed inside `lib/storage.ts`, not read here directly) — without it, `setStoredRefreshToken` throws.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run api/cron.test.ts`
Expected: FAIL — `api/cron.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// server/api/cron.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getStoredRefreshToken, setStoredRefreshToken, setLatestStandings } from '../lib/storage.js'
import { refreshAccessToken } from '../lib/yahoo.js'
import { fetchLeagueStandings } from '../lib/fetchStandings.js'
import { transformStandings } from '../lib/transform.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const yahooEnv = {
    clientId: process.env.YAHOO_CLIENT_ID!,
    clientSecret: process.env.YAHOO_CLIENT_SECRET!,
    redirectUri: process.env.YAHOO_REDIRECT_URI!,
  }

  try {
    const storedRefreshToken = await getStoredRefreshToken()
    const refreshToken = storedRefreshToken ?? process.env.YAHOO_INITIAL_REFRESH_TOKEN!

    const tokens = await refreshAccessToken(refreshToken, yahooEnv)
    await setStoredRefreshToken(tokens.refreshToken)

    const rawStandings = await fetchLeagueStandings(tokens.accessToken, process.env.YAHOO_LEAGUE_KEY!)
    const payload = transformStandings(rawStandings, process.env.YAHOO_MY_TEAM_KEY!, new Date().toISOString())

    await setLatestStandings(payload)

    res.status(200).json({ ok: true, asOf: payload.asOf })
  } catch (err) {
    console.error('cron refresh failed', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run api/cron.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/api/cron.ts server/api/cron.test.ts
git commit -m "feat: add cron orchestration endpoint"
```

---

### Task 8: One-time OAuth setup script

**Files:**
- Create: `server/scripts/setup-yahoo-auth.ts`
- Test: `server/scripts/setup-yahoo-auth.test.ts` (covers only the pure helper, per below)

**Interfaces:**
- Consumes: `buildAuthorizeUrl`, `exchangeCodeForTokens` (Task 2), `setStoredRefreshToken` (Task 3), `findByKey`/`numberedEntries` (Task 4's `lib/yahooJson.ts` — reuse these, do not redefine them here). `setStoredRefreshToken` encrypts with `TOKEN_ENCRYPTION_KEY`, so this script requires that env var set locally before running (it seeds the encrypted blob directly, same as the deployed cron job would).
- Produces: `parseLeagueTeamKeys(rawJson: unknown): Array<{ leagueKey: string; leagueName: string; teamKey: string; teamName: string }>` (pure, unit-tested), plus an interactive `main()` that is run manually, not unit tested (it does readline I/O and live network calls by design).

This script is run once, locally, by a human — not deployed. Its job: get the first refresh token, and print the league/team keys needed for `YAHOO_LEAGUE_KEY` and `YAHOO_MY_TEAM_KEY`.

- [ ] **Step 1: Write the failing test for the pure parsing helper**

```typescript
// server/scripts/setup-yahoo-auth.test.ts
import { describe, it, expect } from 'vitest'
import { parseLeagueTeamKeys } from './setup-yahoo-auth.js'

describe('parseLeagueTeamKeys', () => {
  it('extracts league and team key/name pairs for the logged-in user across their NHL leagues', () => {
    // Shape per Yahoo's numbered-object convention, confirmed against
    // documented field names (league_key, team_key, name) — see design
    // research notes; verify against a live response before relying on
    // exact nesting depth in production.
    const raw = {
      fantasy_content: {
        users: {
          '0': {
            user: [
              {},
              {
                games: {
                  '0': {
                    game: [
                      {},
                      {
                        leagues: {
                          '0': {
                            league: [
                              { league_key: '453.l.1', name: 'My League' },
                              {
                                teams: {
                                  '0': { team: [[{ team_key: '453.l.1.t.7' }, { name: 'My Team' }]] },
                                  count: 1,
                                },
                              },
                            ],
                          },
                          count: 1,
                        },
                      },
                    ],
                  },
                  count: 1,
                },
              },
            ],
          },
          count: 1,
        },
      },
    }

    const result = parseLeagueTeamKeys(raw)

    expect(result).toEqual([
      { leagueKey: '453.l.1', leagueName: 'My League', teamKey: '453.l.1.t.7', teamName: 'My Team' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run scripts/setup-yahoo-auth.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// server/scripts/setup-yahoo-auth.ts
import * as readline from 'node:readline/promises'
import { buildAuthorizeUrl, exchangeCodeForTokens } from '../lib/yahoo.js'
import { setStoredRefreshToken } from '../lib/storage.js'
import { findByKey, numberedEntries } from '../lib/yahooJson.js'

export interface LeagueTeamKey {
  leagueKey: string
  leagueName: string
  teamKey: string
  teamName: string
}

export function parseLeagueTeamKeys(rawJson: unknown): LeagueTeamKey[] {
  const leaguesContainer = findByKey(rawJson, 'leagues') as Record<string, unknown> | undefined
  if (!leaguesContainer) return []

  return numberedEntries(leaguesContainer).map((leagueWrapper) => {
    const leagueArray = (leagueWrapper as { league: unknown[] }).league
    const leagueKey = findByKey(leagueArray, 'league_key') as string
    const leagueName = findByKey(leagueArray, 'name') as string

    const teamsContainer = findByKey(leagueArray, 'teams') as Record<string, unknown>
    const firstTeamWrapper = numberedEntries(teamsContainer)[0]
    const teamArray = (firstTeamWrapper as { team: unknown[] }).team
    const teamKey = findByKey(teamArray, 'team_key') as string
    const teamName = findByKey(teamArray, 'name') as string

    return { leagueKey, leagueName, teamKey, teamName }
  })
}

async function main() {
  const env = {
    clientId: process.env.YAHOO_CLIENT_ID!,
    clientSecret: process.env.YAHOO_CLIENT_SECRET!,
    redirectUri: process.env.YAHOO_REDIRECT_URI!,
  }
  if (!env.clientId || !env.clientSecret || !env.redirectUri) {
    console.error('Set YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REDIRECT_URI in your environment first.')
    process.exit(1)
  }

  console.log('1. Open this URL in a browser and authorize the app:')
  console.log(buildAuthorizeUrl(env))
  console.log('')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const code = await rl.question('2. Paste the "code" query param from the redirect URL: ')
  rl.close()

  const tokens = await exchangeCodeForTokens(code.trim(), env)
  console.log('Got initial tokens.')
  console.log(`YAHOO_INITIAL_REFRESH_TOKEN=${tokens.refreshToken}`)

  await setStoredRefreshToken(tokens.refreshToken)
  console.log('Seeded refresh token into Blob storage (requires BLOB_READ_WRITE_TOKEN in env).')

  const response = await fetch(
    'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=nhl/leagues/teams?format=json',
    { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
  )
  if (!response.ok) {
    console.error(`Could not list leagues/teams: ${response.status} ${await response.text()}`)
    process.exit(1)
  }
  const raw = await response.json()
  const keys = parseLeagueTeamKeys(raw)

  console.log('')
  console.log('Your NHL leagues/teams — pick the right pair for YAHOO_LEAGUE_KEY / YAHOO_MY_TEAM_KEY:')
  for (const k of keys) {
    console.log(`  ${k.leagueName}: YAHOO_LEAGUE_KEY=${k.leagueKey}  YAHOO_MY_TEAM_KEY=${k.teamKey} (${k.teamName})`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run scripts/setup-yahoo-auth.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/scripts/setup-yahoo-auth.ts server/scripts/setup-yahoo-auth.test.ts
git commit -m "feat: add one-time Yahoo OAuth setup script"
```

---

### Task 9: Cron schedule, deployment docs, and live verification

**Files:**
- Modify: `server/vercel.json`
- Create: `server/README.md`

**Interfaces:**
- Consumes: nothing new — this task wires together everything from Tasks 1–8 and verifies it against the real Yahoo API and a real Vercel deployment.

- [ ] **Step 1: Fill in the cron schedule**

```json
{
  "crons": [
    { "path": "/api/cron", "schedule": "55 11 * * *" }
  ]
}
```

Note: Vercel Cron schedules run in UTC and do **not** auto-adjust for daylight saving time. `55 11 * * *` is 7:55am US Eastern during EDT (UTC-4) but becomes 6:55am during EST (UTC-5) — adjust the hour twice a year, or pick a schedule tolerant of the drift, matching however far in advance of the ESP32's 8am local wake you want the data refreshed.

- [ ] **Step 2: Write `server/README.md`**

```markdown
# Fantasy Standings Server

## Environment variables (set in Vercel project settings)

- `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` — from your Yahoo Developer app
- `YAHOO_REDIRECT_URI` — must match the redirect URI registered on the Yahoo app (use `oob` for out-of-band if you don't have a callback page)
- `YAHOO_INITIAL_REFRESH_TOKEN` — bootstrap value from `setup-yahoo-auth.ts`; only used if Blob storage has no rotated token yet
- `YAHOO_LEAGUE_KEY`, `YAHOO_MY_TEAM_KEY` — from `setup-yahoo-auth.ts` output
- `CRON_SECRET` — random string; Vercel sends it automatically as `Authorization: Bearer <value>` when invoking cron-triggered functions
- `SHARED_TOKEN` — random string the ESP32 sends as `?token=` when calling `/api/standings`
- `BLOB_READ_WRITE_TOKEN` — from enabling Vercel Blob on the project
- `TOKEN_ENCRYPTION_KEY` — base64-encoded 32-byte AES-256 key encrypting the stored refresh token at rest in Blob (generate with `openssl rand -base64 32`); required both in Vercel's env and locally when running the setup script, since the script seeds the encrypted blob directly

## One-time setup

1. Register an app at https://developer.yahoo.com/apps/, enable Fantasy Sports read access.
2. Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32` and set it both in Vercel's env vars and locally (`export TOKEN_ENCRYPTION_KEY=...`) before running the setup script.
3. `vercel env pull` (or set the vars above directly in the dashboard) for `YAHOO_CLIENT_ID`/`YAHOO_CLIENT_SECRET`/`YAHOO_REDIRECT_URI` locally.
4. `cd server && npx tsx scripts/setup-yahoo-auth.ts` — follow the prompts, copy the printed `YAHOO_LEAGUE_KEY`/`YAHOO_MY_TEAM_KEY`/`YAHOO_INITIAL_REFRESH_TOKEN` into Vercel's env vars.
5. `vercel deploy --prod`

## Manual verification

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-deployment>.vercel.app/api/cron
curl "https://<your-deployment>.vercel.app/api/standings?token=$SHARED_TOKEN"
```

The second call should return real standings for your league. If the shape looks wrong (empty `rows`, thrown error in cron logs), inspect the raw Yahoo response — `lib/transform.ts`'s `findByKey`/`numberedEntries` helpers search by key name rather than fixed position specifically so this is the one place likely to need adjusting against the live API's exact nesting.
```

- [ ] **Step 3: Deploy and verify end-to-end (manual, not scriptable)**

Run the commands in the README's "Manual verification" section against your real deployment and real Yahoo league. Confirm:
- `/api/cron` returns `{ ok: true, asOf: "..." }`
- `/api/standings` returns real team names/ranks/records matching your actual Yahoo league standings
- Your own team's row has `isMe: true`
- A second `/api/cron` call succeeds using the rotated (Blob-stored) refresh token, not the original bootstrap value — confirms rotation persistence works

If `transformStandings` throws or produces wrong data against the live shape, fix `lib/transform.ts`'s parsing (not its windowing logic, which is already covered by Task 4's tests) and re-run `npx vitest run lib/transform.test.ts` plus this manual check.

- [ ] **Step 4: Commit**

```bash
git add server/vercel.json server/README.md
git commit -m "docs: add cron schedule and deployment instructions"
```
