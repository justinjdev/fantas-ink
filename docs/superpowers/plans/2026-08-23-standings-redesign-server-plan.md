# Standings Redesign — Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the server so `latest.json` includes win%, streak, league name, a playoff cutoff
rank, and three matchup views (current/last/next), per
[2026-08-23-standings-display-redesign-design.md](../specs/2026-08-23-standings-display-redesign-design.md).

**Architecture:** Two new Yahoo fetches (`fetchMyMatchup.ts`, `fetchLeagueSettings.ts`) alongside the
existing `fetchStandings.ts`, each with its own parsing module (`matchup.ts`, `leagueSettings.ts`)
mirroring the existing `fetchStandings.ts`/`transform.ts` split. `cron.ts` orchestrates all three,
treating the two new fetches as independently-optional (failure writes `null` for that section, never
fails the whole run). League settings are cached in Blob storage and only re-fetched when missing,
since they rarely change mid-season.

**Tech Stack:** TypeScript (ESM, `moduleResolution: "Bundler"`), Vitest, `@vercel/blob`, Node `fetch`.

## Global Constraints

- Every source file imports sibling modules with an explicit `.js` extension (e.g.
  `from './transform.js'`), even though the files are `.ts` — this project's existing convention,
  required by `moduleResolution: "Bundler"` + `"type": "module"`.
- New Yahoo API field names (`num_playoff_teams`, `sort_order`, `stat_categories`, matchup `status`
  values, etc.) are best-effort based on Yahoo's documented Fantasy API conventions — **unverified
  against a real payload**, since Yahoo API access is still pending per
  `firmware/HARDWARE_BRINGUP_STATUS.md`. Every task that touches Yahoo's raw JSON shape says so again
  at the point it matters; treat all of it as needing a real-payload sanity check once access clears,
  not as confirmed fact.
- Test fixtures follow the existing `transform.test.ts` style: hand-built raw-JSON objects shaped like
  Yahoo's response, not real captured payloads.
- No new dependencies — everything here uses what's already in `server/package.json`.

---

### Task 1: Win percentage on every standings row

**Files:**
- Modify: `server/lib/transform.ts`
- Test: `server/lib/transform.test.ts`

**Interfaces:**
- Produces: `formatWinPct(wins: number, losses: number, ties: number): string`, exported from
  `transform.ts`. `StandingsRow`'s non-gap variant gains a `winPct: string` field.

- [ ] **Step 1: Write the failing test**

Add to `server/lib/transform.test.ts`:

```typescript
import { transformStandings, formatWinPct } from './transform.js'

describe('formatWinPct', () => {
  it('formats a fractional record without a leading zero', () => {
    expect(formatWinPct(10, 2, 0)).toBe('.833')
  })

  it('formats an undefeated record as 1.000, not .000', () => {
    expect(formatWinPct(12, 0, 0)).toBe('1.000')
  })

  it('formats a winless record as .000', () => {
    expect(formatWinPct(0, 12, 0)).toBe('.000')
  })

  it('counts ties as games played', () => {
    expect(formatWinPct(5, 5, 2)).toBe('.417')
  })

  it('returns .000 for zero games played rather than dividing by zero', () => {
    expect(formatWinPct(0, 0, 0)).toBe('.000')
  })
})
```

Also add one assertion inside the existing `'extracts wins/losses/ties from outcome_totals as numbers'`
test, right after the existing `toMatchObject` call:

```typescript
    expect(rankOne).toMatchObject({ winPct: '1.000' })
```

(Rank 1 in the `makeRawStandings` fixture has `wins: teamCount - i` and `losses: i - 1` — for a
16-team league, rank 1 is `wins: 15, losses: 0`, hence `1.000`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: FAIL — `formatWinPct` is not exported, and the `winPct` assertion fails since the field
doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

In `server/lib/transform.ts`, add the exported function (place it above `parseTeam`):

```typescript
export function formatWinPct(wins: number, losses: number, ties: number): string {
  const games = wins + losses + ties
  const pct = games === 0 ? 0 : wins / games
  const formatted = pct.toFixed(3)
  return formatted.startsWith('0.') ? formatted.slice(1) : formatted
}
```

Update the `StandingsRow` type:

```typescript
export type StandingsRow =
  | { rank: number; name: string; wins: number; losses: number; ties: number; winPct: string; isMe?: true }
  | { gap: true }
```

In `transformStandings`, inside the `for (const rank of includedRanks)` loop, update the `rows.push`
call to include `winPct`:

```typescript
    rows.push({
      rank: team.rank,
      name: team.name,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      winPct: formatWinPct(team.wins, team.losses, team.ties),
      ...(team.teamKey === myTeamKey ? { isMe: true as const } : {}),
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: PASS, all tests including the new `formatWinPct` suite.

- [ ] **Step 5: Commit**

```bash
git add server/lib/transform.ts server/lib/transform.test.ts
git commit -m "feat(server): compute win percentage for each standings row"
```

---

### Task 2: Streak on every standings row

**Files:**
- Modify: `server/lib/transform.ts`
- Test: `server/lib/transform.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `formatStreak(streak: { type: string; value: string | number }): string`, exported from
  `transform.ts`. `StandingsRow`'s non-gap variant gains a `streak: string` field.

- [ ] **Step 1: Write the failing test**

Add to `server/lib/transform.test.ts`:

```typescript
import { transformStandings, formatWinPct, formatStreak } from './transform.js'

describe('formatStreak', () => {
  it('formats a winning streak', () => {
    expect(formatStreak({ type: 'wins', value: '4' })).toBe('W4')
  })

  it('formats a losing streak', () => {
    expect(formatStreak({ type: 'losses', value: '2' })).toBe('L2')
  })

  it('formats a tie streak', () => {
    expect(formatStreak({ type: 'ties', value: '1' })).toBe('T1')
  })

  it('accepts a numeric value, not just a string', () => {
    expect(formatStreak({ type: 'wins', value: 3 })).toBe('W3')
  })
})
```

The `makeTeam` fixture helper needs a streak field so `transformStandings` has something to parse.
Update it in `server/lib/transform.test.ts`:

```typescript
function makeTeam(rank: number, teamKey: string, wins: number, losses: number, ties = 0, streak = { type: 'wins', value: '1' }) {
  return {
    team: [
      [{ team_key: teamKey }, { name: `Team ${rank}` }],
      {
        team_standings: {
          rank,
          outcome_totals: { wins: String(wins), losses: String(losses), ties: String(ties) },
          streak,
        },
      },
    ],
  }
}
```

Add a targeted assertion in the existing `'extracts wins/losses/ties from outcome_totals as numbers'`
test:

```typescript
    expect(rankOne).toMatchObject({ streak: 'W1' })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: FAIL — `formatStreak` not exported, `streak` field missing from rows.

- [ ] **Step 3: Write minimal implementation**

In `server/lib/transform.ts`, add near `formatWinPct`:

```typescript
export function formatStreak(streak: { type: string; value: string | number }): string {
  const letter = streak.type === 'wins' ? 'W' : streak.type === 'losses' ? 'L' : 'T'
  return `${letter}${streak.value}`
}
```

Update `ParsedTeam` and `parseTeam` to carry the raw streak through:

```typescript
interface ParsedTeam {
  teamKey: string
  name: string
  rank: number
  wins: number
  losses: number
  ties: number
  streak: { type: string; value: string | number }
}

function parseTeam(rawTeamWrapper: unknown): ParsedTeam {
  const teamArray = (rawTeamWrapper as { team: unknown[] }).team
  const teamKey = findByKey(teamArray, 'team_key') as string
  const name = findByKey(teamArray, 'name') as string
  const standings = findByKey(teamArray, 'team_standings') as {
    rank: number | string
    outcome_totals: { wins: string; losses: string; ties: string }
    streak: { type: string; value: string | number }
  }

  return {
    teamKey,
    name,
    rank: Number(standings.rank),
    wins: Number(standings.outcome_totals.wins),
    losses: Number(standings.outcome_totals.losses),
    ties: Number(standings.outcome_totals.ties),
    streak: standings.streak,
  }
}
```

Update `StandingsRow` and the `rows.push` call in `transformStandings`:

```typescript
export type StandingsRow =
  | { rank: number; name: string; wins: number; losses: number; ties: number; winPct: string; streak: string; isMe?: true }
  | { gap: true }
```

```typescript
    rows.push({
      rank: team.rank,
      name: team.name,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      winPct: formatWinPct(team.wins, team.losses, team.ties),
      streak: formatStreak(team.streak),
      ...(team.teamKey === myTeamKey ? { isMe: true as const } : {}),
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/transform.ts server/lib/transform.test.ts
git commit -m "feat(server): parse streak for each standings row"
```

---

### Task 3: League name

**Files:**
- Modify: `server/lib/transform.ts`
- Test: `server/lib/transform.test.ts`

**Interfaces:**
- Consumes: `findByKey` from `./yahooJson.js` (already imported).
- Produces: `StandingsPayload` gains a `leagueName: string` field.

- [ ] **Step 1: Write the failing test**

Add to `server/lib/transform.test.ts`, inside the `describe('transformStandings', ...)` block:

```typescript
  it('reads the league name from the top of the raw response, not a team name', () => {
    const raw = makeRawStandings(16)
    const result = transformStandings(raw, '453.l.1.t.8', ASOF)

    expect(result.leagueName).toBe('Test League')
  })
```

`makeRawStandings` already sets `{ league_key: '453.l.1', name: 'Test League' }` as `league[0]` — this
test is checking that `transformStandings` finds *that* `name`, not one of the `Team N` names buried
in `league[1].standings.teams`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: FAIL — `result.leagueName` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `server/lib/transform.ts`, update `StandingsPayload`:

```typescript
export interface StandingsPayload {
  asOf: string
  myTeamKey: string
  leagueName: string
  rows: StandingsRow[]
}
```

In `transformStandings`, read the league name **before** calling `parseAllTeams` and pass it through
on the return. `findByKey` must run on `rawYahooJson` directly — calling it after `parseAllTeams` has
already scoped down to the teams container would find a team's `name` instead, since `name` isn't
unique to the league object:

```typescript
export function transformStandings(rawYahooJson: unknown, myTeamKey: string, asOf: string): StandingsPayload {
  const leagueName = findByKey(rawYahooJson, 'name') as string
  const teams = parseAllTeams(rawYahooJson)
  const myTeam = teams.find((t) => t.teamKey === myTeamKey)
  if (!myTeam) {
    throw new Error(`myTeamKey ${myTeamKey} not found in standings response`)
  }

  // ... existing windowing logic unchanged ...

  return { asOf, myTeamKey, leagueName, rows }
}
```

(Only the first line and the final `return` statement change — the windowing logic in between is
untouched.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/transform.ts server/lib/transform.test.ts
git commit -m "feat(server): read league name from the top-level raw response"
```

---

### Task 4: Export team lookups for reuse by the matchup/cron code

**Files:**
- Modify: `server/lib/transform.ts`
- Test: `server/lib/transform.test.ts`

**Interfaces:**
- Produces: `parseAllTeams(rawYahooJson: unknown): ParsedTeam[]` and the `ParsedTeam` type, both now
  exported. `formatRecord(wins: number, losses: number, ties: number): string`, newly added and
  exported.

This task exists because `nextMatchup.opponentRecord` (Task 9) needs a team's record even when that
team isn't one of the 9 displayed rows — `parseAllTeams` already parses every team before windowing
down, so exposing it avoids a second fetch. `formatRecord` is the `"6-6-0"` formatter both `cron.ts`
and (potentially) other callers need.

- [ ] **Step 1: Write the failing test**

Add to `server/lib/transform.test.ts`:

```typescript
import { transformStandings, formatWinPct, formatStreak, parseAllTeams, formatRecord } from './transform.js'

describe('parseAllTeams', () => {
  it('is exported and returns every team, not just the windowed subset', () => {
    const raw = makeRawStandings(16)
    const teams = parseAllTeams(raw)

    expect(teams).toHaveLength(16)
    expect(teams.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  })

  it('can look up a team not in a windowed rows[] result by team key', () => {
    const raw = makeRawStandings(16)
    const teams = parseAllTeams(raw)

    const rankFour = teams.find((t) => t.teamKey === '453.l.1.t.4')
    expect(rankFour).toMatchObject({ rank: 4, wins: 12, losses: 3 })
  })
})

describe('formatRecord', () => {
  it('formats a record as wins-losses-ties', () => {
    expect(formatRecord(6, 6, 0)).toBe('6-6-0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: FAIL — `parseAllTeams` and `formatRecord` are not exported (TypeScript import error).

- [ ] **Step 3: Write minimal implementation**

In `server/lib/transform.ts`, add `export` to both the `ParsedTeam` interface and the `parseAllTeams`
function (no logic changes, just visibility):

```typescript
export interface ParsedTeam {
  teamKey: string
  name: string
  rank: number
  wins: number
  losses: number
  ties: number
  streak: { type: string; value: string | number }
}

export function parseAllTeams(rawYahooJson: unknown): ParsedTeam[] {
  const teamsContainer = findByKey(rawYahooJson, 'teams') as Record<string, unknown>
  return numberedEntries(teamsContainer)
    .map(parseTeam)
    .sort((a, b) => a.rank - b.rank)
}
```

Add `formatRecord` near `formatWinPct`:

```typescript
export function formatRecord(wins: number, losses: number, ties: number): string {
  return `${wins}-${losses}-${ties}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/transform.ts server/lib/transform.test.ts
git commit -m "feat(server): export parseAllTeams and add formatRecord for cross-module reuse"
```

---

### Task 5: Fetch league settings

**Files:**
- Create: `server/lib/fetchLeagueSettings.ts`
- Test: `server/lib/fetchLeagueSettings.test.ts`

**Interfaces:**
- Produces: `fetchLeagueSettings(accessToken: string, leagueKey: string): Promise<unknown>`.

Mirrors `fetchStandings.ts` exactly — same shape, same test style, different endpoint.

- [ ] **Step 1: Write the failing test**

Create `server/lib/fetchLeagueSettings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchLeagueSettings } from './fetchLeagueSettings.js'

describe('fetchLeagueSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the league settings endpoint with a bearer token and format=json', async () => {
    const rawJson = { fantasy_content: { league: [] } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rawJson })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchLeagueSettings('access-token-123', '453.l.1')

    expect(result).toBe(rawJson)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://fantasysports.yahooapis.com/fantasy/v2/league/453.l.1/settings?format=json')
    expect(init.headers['Authorization']).toBe('Bearer access-token-123')
  })

  it('throws with status on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
    )

    await expect(fetchLeagueSettings('bad-token', '453.l.1')).rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/fetchLeagueSettings.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `server/lib/fetchLeagueSettings.ts`:

```typescript
const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2'

export async function fetchLeagueSettings(accessToken: string, leagueKey: string): Promise<unknown> {
  const url = `${BASE_URL}/league/${leagueKey}/settings?format=json`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Yahoo league settings request failed: ${response.status} ${text}`)
  }

  return response.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/fetchLeagueSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/fetchLeagueSettings.ts server/lib/fetchLeagueSettings.test.ts
git commit -m "feat(server): fetch Yahoo league settings"
```

---

### Task 6: Parse league settings (stat categories + playoff cutoff)

**Files:**
- Create: `server/lib/leagueSettings.ts`
- Test: `server/lib/leagueSettings.test.ts`

**Interfaces:**
- Consumes: `findByKey` from `./yahooJson.js`.
- Produces: `CategoryDef` (`{ statId: string; label: string; higherWins: boolean }`), `LeagueSettings`
  (`{ categories: CategoryDef[]; playoffTeams: number | null }`), and
  `parseLeagueSettings(rawYahooJson: unknown): LeagueSettings`, all exported from `leagueSettings.ts`.

**Yahoo shape assumption (unverified, see Global Constraints):** the settings resource nests
`stat_categories.stats`, an array of `{ stat: { stat_id, display_name, sort_order } }`, where
`sort_order` is `"1"` for higher-is-better stats and `"0"` for lower-is-better (e.g. GAA), and
`num_playoff_teams` sits directly on the settings object.

- [ ] **Step 1: Write the failing test**

Create `server/lib/leagueSettings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseLeagueSettings } from './leagueSettings.js'

function makeRawSettings() {
  return {
    fantasy_content: {
      league: [
        { league_key: '453.l.1', name: 'Test League' },
        {
          settings: [
            {
              num_playoff_teams: '6',
              stat_categories: {
                stats: [
                  { stat: { stat_id: '1', name: 'Goals', display_name: 'G', sort_order: '1' } },
                  { stat: { stat_id: '2', name: 'Assists', display_name: 'A', sort_order: '1' } },
                  {
                    stat: {
                      stat_id: '26',
                      name: 'Goals Against Average',
                      display_name: 'GAA',
                      sort_order: '0',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  }
}

describe('parseLeagueSettings', () => {
  it('extracts every stat category with its label and direction', () => {
    const result = parseLeagueSettings(makeRawSettings())

    expect(result.categories).toEqual([
      { statId: '1', label: 'G', higherWins: true },
      { statId: '2', label: 'A', higherWins: true },
      { statId: '26', label: 'GAA', higherWins: false },
    ])
  })

  it('extracts the playoff team count as a number', () => {
    const result = parseLeagueSettings(makeRawSettings())
    expect(result.playoffTeams).toBe(6)
  })

  it('returns an empty category list and null playoffTeams for a malformed response, not a throw', () => {
    const result = parseLeagueSettings({ fantasy_content: {} })
    expect(result).toEqual({ categories: [], playoffTeams: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/leagueSettings.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `server/lib/leagueSettings.ts`:

```typescript
import { findByKey } from './yahooJson.js'

export interface CategoryDef {
  statId: string
  label: string
  higherWins: boolean
}

export interface LeagueSettings {
  categories: CategoryDef[]
  playoffTeams: number | null
}

export function parseLeagueSettings(rawYahooJson: unknown): LeagueSettings {
  const settingsNode = findByKey(rawYahooJson, 'settings')

  const numPlayoffTeamsRaw = findByKey(settingsNode, 'num_playoff_teams')
  const playoffTeams = numPlayoffTeamsRaw != null ? Number(numPlayoffTeamsRaw) : null

  const statCategories = findByKey(settingsNode, 'stat_categories') as { stats?: unknown } | undefined
  const statEntries = Array.isArray(statCategories?.stats) ? (statCategories!.stats as unknown[]) : []

  const categories: CategoryDef[] = statEntries.map((entry) => {
    const stat = (entry as { stat: Record<string, unknown> }).stat
    return {
      statId: String(stat.stat_id),
      label: String(stat.display_name),
      higherWins: String(stat.sort_order) !== '0',
    }
  })

  return { categories, playoffTeams }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/leagueSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/leagueSettings.ts server/lib/leagueSettings.test.ts
git commit -m "feat(server): parse stat categories and playoff cutoff from league settings"
```

---

### Task 7: Cache league settings in Blob storage

**Files:**
- Modify: `server/lib/storage.ts`
- Test: `server/lib/storage.test.ts`

**Interfaces:**
- Consumes: `LeagueSettings` type from `./leagueSettings.js`.
- Produces: `getCachedLeagueSettings(): Promise<LeagueSettings | null>` and
  `setCachedLeagueSettings(settings: LeagueSettings): Promise<void>`, exported from `storage.ts`.

League settings rarely change mid-season (per the design spec) — this avoids re-fetching them on
every cron run. Mirrors the existing `getLatestStandings`/`setLatestStandings` pair exactly.

- [ ] **Step 1: Write the failing test**

Check the existing test style first — read `server/lib/storage.test.ts` to match how it mocks
`@vercel/blob`'s `put`/`head` before writing new tests, since the mocking setup must match exactly
what's already there (this task assumes the same `vi.mock('@vercel/blob', ...)` pattern already used
for `getLatestStandings`/`setLatestStandings` — copy that pattern for the new pair rather than
inventing a different mocking approach).

Add to `server/lib/storage.test.ts`, following the existing `getLatestStandings`/`setLatestStandings`
test pattern in that file:

```typescript
import { getCachedLeagueSettings, setCachedLeagueSettings } from './storage.js'
import type { LeagueSettings } from './leagueSettings.js'

describe('league settings cache', () => {
  const settings: LeagueSettings = {
    categories: [{ statId: '1', label: 'G', higherWins: true }],
    playoffTeams: 6,
  }

  it('returns null when nothing has been cached yet', async () => {
    // Arrange the mocked `head` to reject as not-found, same as the existing
    // "returns null when nothing is cached" test for getLatestStandings.
    const result = await getCachedLeagueSettings()
    expect(result).toBeNull()
  })

  it('round-trips settings written with setCachedLeagueSettings', async () => {
    await setCachedLeagueSettings(settings)
    const result = await getCachedLeagueSettings()
    expect(result).toEqual(settings)
  })
})
```

Adjust the exact mock setup (how `head`/`put`/`fetch` are stubbed) to match whatever pattern
`getLatestStandings`/`setLatestStandings`'s existing tests already use in this file — don't introduce
a second, different mocking style.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/storage.test.ts`
Expected: FAIL — `getCachedLeagueSettings`/`setCachedLeagueSettings` not exported.

- [ ] **Step 3: Write minimal implementation**

In `server/lib/storage.ts`, add the import and a new path constant near the existing ones:

```typescript
import type { LeagueSettings } from './leagueSettings.js'
```

```typescript
const LEAGUE_SETTINGS_PATH = 'league-settings.json'
```

Add the two functions near `getLatestStandings`/`setLatestStandings`:

```typescript
export async function getCachedLeagueSettings(): Promise<LeagueSettings | null> {
  return readJsonBlob<LeagueSettings>(LEAGUE_SETTINGS_PATH)
}

export async function setCachedLeagueSettings(settings: LeagueSettings): Promise<void> {
  await put(LEAGUE_SETTINGS_PATH, JSON.stringify(settings), {
    access: 'public',
    contentType: 'application/json',
    cacheControlMaxAge: MIN_CACHE_CONTROL_MAX_AGE,
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/storage.ts server/lib/storage.test.ts
git commit -m "feat(server): cache league settings in Blob storage"
```

---

### Task 8: Fetch my team's matchups

**Files:**
- Create: `server/lib/fetchMyMatchup.ts`
- Test: `server/lib/fetchMyMatchup.test.ts`

**Interfaces:**
- Produces: `fetchMyMatchups(accessToken: string, teamKey: string): Promise<unknown>`.

Mirrors `fetchStandings.ts` again — same shape, different endpoint and path parameter.

- [ ] **Step 1: Write the failing test**

Create `server/lib/fetchMyMatchup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchMyMatchups } from './fetchMyMatchup.js'

describe('fetchMyMatchups', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the team matchups endpoint with a bearer token and format=json', async () => {
    const rawJson = { fantasy_content: { team: [] } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rawJson })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMyMatchups('access-token-123', '453.l.1.t.8')

    expect(result).toBe(rawJson)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://fantasysports.yahooapis.com/fantasy/v2/team/453.l.1.t.8/matchups?format=json')
    expect(init.headers['Authorization']).toBe('Bearer access-token-123')
  })

  it('throws with status on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
    )

    await expect(fetchMyMatchups('bad-token', '453.l.1.t.8')).rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/fetchMyMatchup.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `server/lib/fetchMyMatchup.ts`:

```typescript
const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2'

export async function fetchMyMatchups(accessToken: string, teamKey: string): Promise<unknown> {
  const url = `${BASE_URL}/team/${teamKey}/matchups?format=json`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Yahoo matchups request failed: ${response.status} ${text}`)
  }

  return response.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/fetchMyMatchup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/fetchMyMatchup.ts server/lib/fetchMyMatchup.test.ts
git commit -m "feat(server): fetch my team's matchups from Yahoo"
```

---

### Task 9: Parse matchups into current/last/next views

**Files:**
- Create: `server/lib/matchup.ts`
- Test: `server/lib/matchup.test.ts`

**Interfaces:**
- Consumes: `findByKey`, `numberedEntries` from `./yahooJson.js`; `CategoryDef` from
  `./leagueSettings.js`.
- Produces: `CategoryStat`, `CurrentMatchup`, `MatchupSummary`, `NextOpponent`, `ParsedMatchups`
  (all exported types), and `parseMatchups(rawYahooJson: unknown, myTeamKey: string, categories: CategoryDef[]): ParsedMatchups`.

**Yahoo shape assumption (unverified, see Global Constraints):** `team.matchups` is a numbered
container (same `{0: {...}, 1: {...}, count: N}` convention as `teams` elsewhere in this codebase) of
`{ matchup: { week, status, teams, winner_team_key? } }`, where `status` is `"preevent"`,
`"midevent"`, or `"postevent"`, and each matchup's `teams` is itself a numbered container of two
`{ team: [...] }` wrappers shaped like the ones `transform.ts` already parses, each additionally
carrying `team_stats.stats` — an array of `{ stat: { stat_id, value } }` — inside the same wrapper
array as `team_key`/`name`.

**Status wording:** both "current" (in-progress) and "last" (decided) status words are derived the
same way — by comparing category-by-category leads using each category's `higherWins` — rather than
trusting Yahoo's `winner_team_key` as a second, inconsistent source of truth for the same fact.
"Current" uses AHEAD/BEHIND/TIED; "last" uses WON/LOST/TIED; both come from one shared comparison
function.

- [ ] **Step 1: Write the failing test**

Create `server/lib/matchup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseMatchups } from './matchup.js'
import type { CategoryDef } from './leagueSettings.js'

const CATEGORIES: CategoryDef[] = [
  { statId: '1', label: 'G', higherWins: true },
  { statId: '2', label: 'A', higherWins: true },
  { statId: '26', label: 'GAA', higherWins: false },
]

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
        '0': { team: makeMatchupTeam('453.l.1.t.8', 'Cellar Dwellers', myStats).team },
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
        [{ team_key: '453.l.1.t.8' }, { name: 'Cellar Dwellers' }],
        { matchups: { ...matchups, count: Object.keys(matchups).length } },
      ],
    },
  }
}

describe('parseMatchups', () => {
  it('builds the current matchup from a midevent entry, with per-category tally', () => {
    const raw = makeRawMatchups({
      '0': makeMatchup(20, 'midevent', { '1': '14', '2': '18', '26': '2.85' }, { '1': '10', '2': '22', '26': '2.60' }),
    })

    const result = parseMatchups(raw, '453.l.1.t.8', CATEGORIES)

    expect(result.current).toEqual({
      opponent: 'Puck Norris',
      status: 'BEHIND', // I lead G only (higherWins), they lead A (higherWins) and GAA (lower wins, 2.60 < 2.85)
      tally: '1-2-0',
      categories: [
        { label: 'G', mine: 14, theirs: 10, higherWins: true },
        { label: 'A', mine: 18, theirs: 22, higherWins: true },
        { label: 'GAA', mine: 2.85, theirs: 2.6, higherWins: false },
      ],
    })
  })

  it('builds the last matchup from the most recent postevent entry', () => {
    const raw = makeRawMatchups({
      '0': makeMatchup(18, 'postevent', { '1': '5', '2': '3', '26': '3.10' }, { '1': '2', '2': '9', '26': '2.90' }),
      '1': makeMatchup(19, 'postevent', { '1': '3', '2': '5', '26': '2.60' }, { '1': '5', '2': '5', '26': '2.85' }),
    })

    const result = parseMatchups(raw, '453.l.1.t.8', CATEGORIES)

    // Week 19 is more recent than week 18 — must pick that one, not the first in the container.
    expect(result.last).toEqual({ opponent: 'Puck Norris', status: 'WON', tally: '2-1-0' })
  })

  it('builds the next matchup from the soonest preevent entry, with no status or tally', () => {
    const raw = makeRawMatchups({
      '0': makeMatchup(22, 'preevent', {}, {}),
      '1': makeMatchup(21, 'preevent', {}, {}),
    })

    const result = parseMatchups(raw, '453.l.1.t.8', CATEGORIES)

    // Week 21 is sooner than week 22 — must pick that one.
    expect(result.next).toEqual({ opponent: 'Puck Norris', opponentTeamKey: '453.l.1.t.2' })
  })

  it('returns null for any matchup state with no matching entry, not a throw', () => {
    const raw = makeRawMatchups({})
    const result = parseMatchups(raw, '453.l.1.t.8', CATEGORIES)
    expect(result).toEqual({ current: null, last: null, next: null })
  })

  it('marks a tied current matchup correctly', () => {
    const raw = makeRawMatchups({
      '0': makeMatchup(20, 'midevent', { '1': '10' }, { '1': '10' }),
    })
    const categories: CategoryDef[] = [{ statId: '1', label: 'G', higherWins: true }]

    const result = parseMatchups(raw, '453.l.1.t.8', categories)

    expect(result.current?.status).toBe('TIED')
    expect(result.current?.tally).toBe('0-0-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/matchup.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `server/lib/matchup.ts`:

```typescript
import { findByKey, numberedEntries } from './yahooJson.js'
import type { CategoryDef } from './leagueSettings.js'

export interface CategoryStat {
  label: string
  mine: number
  theirs: number
  higherWins: boolean
}

export interface CurrentMatchup {
  opponent: string
  status: 'AHEAD' | 'BEHIND' | 'TIED'
  tally: string
  categories: CategoryStat[]
}

export interface MatchupSummary {
  opponent: string
  status: 'WON' | 'LOST' | 'TIED'
  tally: string
}

export interface NextOpponent {
  opponent: string
  opponentTeamKey: string
}

export interface ParsedMatchups {
  current: CurrentMatchup | null
  last: MatchupSummary | null
  next: NextOpponent | null
}

interface RawMatchupTeam {
  teamKey: string
  name: string
  stats: Record<string, string>
}

interface RawMatchup {
  week: number
  status: string
  me: RawMatchupTeam
  opponent: RawMatchupTeam
}

function parseMatchupTeam(teamWrapper: unknown): RawMatchupTeam {
  const teamArray = (teamWrapper as { team: unknown[] }).team
  const teamKey = findByKey(teamArray, 'team_key') as string
  const name = findByKey(teamArray, 'name') as string
  const statsContainer = findByKey(teamArray, 'team_stats') as { stats?: unknown[] } | undefined
  const statEntries = Array.isArray(statsContainer?.stats) ? statsContainer!.stats : []
  const stats: Record<string, string> = {}
  for (const entry of statEntries) {
    const stat = (entry as { stat: { stat_id: string; value: string } }).stat
    stats[stat.stat_id] = stat.value
  }
  return { teamKey, name, stats }
}

function parseOneMatchup(matchupWrapper: unknown, myTeamKey: string): RawMatchup | null {
  const matchup = (matchupWrapper as { matchup: Record<string, unknown> }).matchup
  const teamsContainer = findByKey(matchup, 'teams') as Record<string, unknown>
  const teamEntries = numberedEntries(teamsContainer).map(parseMatchupTeam)
  const me = teamEntries.find((t) => t.teamKey === myTeamKey)
  const opponent = teamEntries.find((t) => t.teamKey !== myTeamKey)
  if (!me || !opponent) return null

  return {
    week: Number(matchup.week),
    status: String(matchup.status),
    me,
    opponent,
  }
}

function parseAllMatchups(rawYahooJson: unknown, myTeamKey: string): RawMatchup[] {
  const matchupsContainer = findByKey(rawYahooJson, 'matchups') as Record<string, unknown>
  if (!matchupsContainer) return []
  return numberedEntries(matchupsContainer)
    .map((wrapper) => parseOneMatchup(wrapper, myTeamKey))
    .filter((m): m is RawMatchup => m !== null)
}

function buildCategoryStats(matchup: RawMatchup, categories: CategoryDef[]): CategoryStat[] {
  return categories.map((cat) => ({
    label: cat.label,
    mine: Number(matchup.me.stats[cat.statId]),
    theirs: Number(matchup.opponent.stats[cat.statId]),
    higherWins: cat.higherWins,
  }))
}

function tallyCategoryWins(categoryStats: CategoryStat[]): { mine: number; theirs: number; ties: number } {
  let mine = 0
  let theirs = 0
  let ties = 0
  for (const c of categoryStats) {
    const meLeads = c.higherWins ? c.mine > c.theirs : c.mine < c.theirs
    const theyLead = c.higherWins ? c.theirs > c.mine : c.theirs < c.mine
    if (meLeads) mine++
    else if (theyLead) theirs++
    else ties++
  }
  return { mine, theirs, ties }
}

export function parseMatchups(rawYahooJson: unknown, myTeamKey: string, categories: CategoryDef[]): ParsedMatchups {
  const all = parseAllMatchups(rawYahooJson, myTeamKey)

  const midevent = all.filter((m) => m.status === 'midevent')
  const postevent = all.filter((m) => m.status === 'postevent').sort((a, b) => b.week - a.week)
  const preevent = all.filter((m) => m.status === 'preevent').sort((a, b) => a.week - b.week)

  let current: CurrentMatchup | null = null
  if (midevent.length > 0) {
    const m = midevent[0]
    const categoryStats = buildCategoryStats(m, categories)
    const tally = tallyCategoryWins(categoryStats)
    const status = tally.mine > tally.theirs ? 'AHEAD' : tally.mine < tally.theirs ? 'BEHIND' : 'TIED'
    current = {
      opponent: m.opponent.name,
      status,
      tally: `${tally.mine}-${tally.theirs}-${tally.ties}`,
      categories: categoryStats,
    }
  }

  let last: MatchupSummary | null = null
  if (postevent.length > 0) {
    const m = postevent[0]
    const categoryStats = buildCategoryStats(m, categories)
    const tally = tallyCategoryWins(categoryStats)
    const status = tally.mine > tally.theirs ? 'WON' : tally.mine < tally.theirs ? 'LOST' : 'TIED'
    last = {
      opponent: m.opponent.name,
      status,
      tally: `${tally.mine}-${tally.theirs}-${tally.ties}`,
    }
  }

  let next: NextOpponent | null = null
  if (preevent.length > 0) {
    const m = preevent[0]
    next = { opponent: m.opponent.name, opponentTeamKey: m.opponent.teamKey }
  }

  return { current, last, next }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/matchup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/matchup.ts server/lib/matchup.test.ts
git commit -m "feat(server): parse current/last/next matchup views with category tally"
```

---

### Task 10: Sanitize free-text names to ASCII

**Files:**
- Create: `server/lib/asciiSanitize.ts`
- Modify: `server/lib/transform.ts`, `server/lib/matchup.ts`
- Test: `server/lib/asciiSanitize.test.ts`, plus one assertion each in `transform.test.ts` and
  `matchup.test.ts`

**Interfaces:**
- Produces: `sanitizeAscii(text: string): string`, exported from `asciiSanitize.ts`.

The design spec flags this explicitly: `leagueName` and every team `name` (including matchup
opponent names) are free text Yahoo users chose, unlike this project's own fixed UI strings — plausibly
containing emoji or accented characters. The firmware's vendored fonts only cover ASCII `0x20`–`0x7E`
(confirmed against the font headers during this session's UX review of the display mockup), so
unsanitized text risks silently failing to render on the real panel. This is caught server-side, once,
rather than needing fallback handling on the firmware side for every place a name gets drawn.

- [ ] **Step 1: Write the failing test**

Create `server/lib/asciiSanitize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { sanitizeAscii } from './asciiSanitize.js'

describe('sanitizeAscii', () => {
  it('passes plain ASCII text through unchanged', () => {
    expect(sanitizeAscii('Zamboni Drivers')).toBe('Zamboni Drivers')
  })

  it('transliterates common accented Latin characters to their ASCII base letter', () => {
    expect(sanitizeAscii('Café Champions')).toBe('Cafe Champions')
  })

  it('strips characters with no reasonable ASCII equivalent, e.g. emoji', () => {
    expect(sanitizeAscii('Puck Norris 🏒')).toBe('Puck Norris')
  })

  it('collapses whitespace left behind by stripped characters', () => {
    expect(sanitizeAscii('Ice   🧊   Capades')).toBe('Ice Capades')
  })

  it('returns an empty string, not a crash, for an all-non-ASCII input', () => {
    expect(sanitizeAscii('🏒🥅🏆')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/asciiSanitize.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `server/lib/asciiSanitize.ts`:

```typescript
// Normalizes to NFKD (splits accented characters into a base letter + a
// combining diacritical mark), strips the marks and anything else outside
// printable ASCII, then collapses whitespace left behind by removed
// characters. The firmware's vendored fonts only cover 0x20-0x7E; this is
// the one place that constraint gets enforced, so nothing downstream needs
// its own per-glyph fallback.
export function sanitizeAscii(text: string): string {
  const stripped = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .replace(/[^\x20-\x7E]/g, '')
  return stripped.replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/asciiSanitize.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into transform.ts and matchup.ts, with a test each, then commit**

In `server/lib/transform.ts`, import `sanitizeAscii` and apply it in two places: `parseTeam`'s `name`
extraction, and `transformStandings`'s `leagueName` extraction.

```typescript
import { sanitizeAscii } from './asciiSanitize.js'
```

```typescript
  const name = sanitizeAscii(findByKey(teamArray, 'name') as string)
```

(inside `parseTeam`, replacing the existing unsanitized assignment)

```typescript
  const leagueName = sanitizeAscii(findByKey(rawYahooJson, 'name') as string)
```

(inside `transformStandings`, replacing the existing unsanitized assignment)

Add to `server/lib/transform.test.ts`:

```typescript
  it('sanitizes non-ASCII characters out of team and league names', () => {
    const raw = makeRawStandings(16)
    raw.fantasy_content.league[0].name = 'Café Legends 🏒'
    const result = transformStandings(raw, '453.l.1.t.8', ASOF)
    expect(result.leagueName).toBe('Cafe Legends')
  })
```

In `server/lib/matchup.ts`, import `sanitizeAscii` and apply it in `parseMatchupTeam`'s `name`
extraction:

```typescript
import { sanitizeAscii } from './asciiSanitize.js'
```

```typescript
  const name = sanitizeAscii(findByKey(teamArray, 'name') as string)
```

(inside `parseMatchupTeam`, replacing the existing unsanitized assignment)

Add to `server/lib/matchup.test.ts`:

```typescript
  it('sanitizes non-ASCII characters out of the opponent name', () => {
    const raw = makeRawMatchups({
      '0': makeMatchup(20, 'midevent', { '1': '10' }, { '1': '5' }),
    })
    raw.fantasy_content.team[1].matchups['0'].matchup.teams['1'].team[0][1].name = 'Café Team 🏒'
    const categories: CategoryDef[] = [{ statId: '1', label: 'G', higherWins: true }]

    const result = parseMatchups(raw, '453.l.1.t.8', categories)

    expect(result.current?.opponent).toBe('Cafe Team')
  })
```

Run: `cd server && npx vitest run lib/transform.test.ts lib/matchup.test.ts lib/asciiSanitize.test.ts`
Expected: PASS, all three files.

```bash
git add server/lib/asciiSanitize.ts server/lib/asciiSanitize.test.ts server/lib/transform.ts server/lib/transform.test.ts server/lib/matchup.ts server/lib/matchup.test.ts
git commit -m "feat(server): sanitize team and league names to ASCII for the firmware's fonts"
```

---

### Task 11: Extend the stored payload type

**Files:**
- Modify: `server/lib/storage.ts`
- Test: `server/lib/storage.test.ts`

**Interfaces:**
- Consumes: `StandingsPayload` from `./transform.js`; `CurrentMatchup`, `MatchupSummary` from
  `./matchup.js`.
- Produces: `NextMatchupInfo` (`{ opponent: string; opponentRecord: string }`) and
  `LatestStandingsPayload` (extends `StandingsPayload` with `playoffTeams`, `currentMatchup`,
  `lastMatchup`, `nextMatchup`), both exported from `storage.ts`. `getLatestStandings`/
  `setLatestStandings` retyped to use `LatestStandingsPayload`.

- [ ] **Step 1: Write the failing test**

Add to `server/lib/storage.test.ts`, extending whatever `getLatestStandings`/`setLatestStandings`
round-trip test already exists there — this step is a type-level check more than a behavioral one, so
the test just needs to confirm the extra fields survive a round trip:

```typescript
import type { LatestStandingsPayload } from './storage.js'

describe('latest standings payload — matchup and playoff fields', () => {
  it('round-trips playoffTeams and all three matchup fields, including nulls', async () => {
    const payload: LatestStandingsPayload = {
      asOf: '2026-08-23T11:55:00Z',
      myTeamKey: '453.l.1.t.8',
      leagueName: 'Test League',
      rows: [],
      playoffTeams: 6,
      currentMatchup: {
        opponent: 'Ice Capades',
        status: 'AHEAD',
        tally: '7-5-1',
        categories: [{ label: 'G', mine: 14, theirs: 10, higherWins: true }],
      },
      lastMatchup: { opponent: 'Puck Norris', status: 'LOST', tally: '3-5-1' },
      nextMatchup: null,
    }

    await setLatestStandings(payload)
    const result = await getLatestStandings()

    expect(result).toEqual(payload)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run lib/storage.test.ts`
Expected: FAIL — TypeScript error, `LatestStandingsPayload` not exported / fields don't exist on
`StandingsPayload`.

- [ ] **Step 3: Write minimal implementation**

In `server/lib/storage.ts`, update the import and add the new types:

```typescript
import type { StandingsPayload } from './transform.js'
import type { CurrentMatchup, MatchupSummary } from './matchup.js'
```

```typescript
export interface NextMatchupInfo {
  opponent: string
  opponentRecord: string
}

export interface LatestStandingsPayload extends StandingsPayload {
  playoffTeams: number | null
  currentMatchup: CurrentMatchup | null
  lastMatchup: MatchupSummary | null
  nextMatchup: NextMatchupInfo | null
}
```

Update the two existing functions' signatures (bodies are unchanged — `readJsonBlob`/`put` don't care
about the TS type, only the generic parameter changes):

```typescript
export async function getLatestStandings(): Promise<LatestStandingsPayload | null> {
  return readJsonBlob<LatestStandingsPayload>(STANDINGS_PATH)
}

export async function setLatestStandings(payload: LatestStandingsPayload): Promise<void> {
  await put(STANDINGS_PATH, JSON.stringify(payload), {
    access: 'public',
    contentType: 'application/json',
    cacheControlMaxAge: MIN_CACHE_CONTROL_MAX_AGE,
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run lib/storage.test.ts`
Expected: PASS. Running `cd server && npx tsc --noEmit` at this point will show a type error in
`cron.ts` — it's still building the old, narrower payload shape and doesn't yet satisfy
`LatestStandingsPayload`'s new required fields. That's expected here, not a regression to chase down;
Task 12 (next) is exactly the fix. Don't skip this typecheck later, just don't expect it clean yet.

- [ ] **Step 5: Commit**

```bash
git add server/lib/storage.ts server/lib/storage.test.ts
git commit -m "feat(server): extend stored payload with playoff and matchup fields"
```

---

### Task 12: Wire it all together in the cron job

**Files:**
- Modify: `server/api/cron.ts`
- Test: `server/api/cron.test.ts` (create — no test file exists for `cron.ts` today; check the repo
  for one before creating, in case that's changed since this plan was written)

**Interfaces:**
- Consumes: `parseAllTeams`, `formatRecord` from `../lib/transform.js`; `fetchLeagueSettings` from
  `../lib/fetchLeagueSettings.js`; `parseLeagueSettings` from `../lib/leagueSettings.js`;
  `getCachedLeagueSettings`, `setCachedLeagueSettings` from `../lib/storage.js`; `fetchMyMatchups`
  from `../lib/fetchMyMatchup.js`; `parseMatchups` from `../lib/matchup.js`.
- Produces: the assembled `LatestStandingsPayload` written via `setLatestStandings`.

This is the orchestration task — every fetch added in Tasks 5–9 gets wired in here, each independently
optional per the design spec's Error Handling section: a failure in the settings or matchup fetch
logs and degrades to `null` for that section, it never fails the whole cron run (the standings fetch
staying mandatory is unchanged — that's the one thing the endpoint has always required to publish
anything at all).

- [ ] **Step 1: Write the failing test**

First check whether `server/api/cron.test.ts` already exists (it may have been added between this
plan being written and being executed) — if it does, extend it following its existing mocking
conventions instead of the fresh setup below.

Create `server/api/cron.test.ts` if it doesn't exist:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import handler from './cron.js'

const BASE_ENV = {
  CRON_SECRET: 'test-cron-secret',
  YAHOO_CLIENT_ID: 'client-id',
  YAHOO_CLIENT_SECRET: 'client-secret',
  YAHOO_REDIRECT_URI: 'https://example.com/callback',
  YAHOO_INITIAL_REFRESH_TOKEN: 'initial-refresh-token',
  YAHOO_LEAGUE_KEY: '453.l.1',
  YAHOO_MY_TEAM_KEY: '453.l.1.t.8',
}

function makeReqRes() {
  const req = { headers: { authorization: `Bearer ${BASE_ENV.CRON_SECRET}` } } as any
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  } as any
  return { req, res }
}

describe('cron handler — matchup and settings degrade independently', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
  })

  it('still publishes standings when the matchup fetch fails', async () => {
    vi.mock('../lib/yahoo.js', () => ({
      refreshAccessToken: vi.fn().mockResolvedValue({ accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600 }),
    }))
    vi.mock('../lib/storage.js', () => ({
      getStoredRefreshToken: vi.fn().mockResolvedValue(null),
      setStoredRefreshToken: vi.fn().mockResolvedValue(undefined),
      setLatestStandings: vi.fn().mockResolvedValue(undefined),
      getCachedLeagueSettings: vi.fn().mockResolvedValue({ categories: [], playoffTeams: 6 }),
      setCachedLeagueSettings: vi.fn().mockResolvedValue(undefined),
    }))
    vi.mock('../lib/fetchStandings.js', () => ({
      fetchLeagueStandings: vi.fn().mockResolvedValue({
        fantasy_content: {
          league: [
            { league_key: '453.l.1', name: 'Test League' },
            {
              standings: [
                {
                  teams: {
                    '0': {
                      team: [
                        [{ team_key: '453.l.1.t.8' }, { name: 'Cellar Dwellers' }],
                        {
                          team_standings: {
                            rank: 1,
                            outcome_totals: { wins: '5', losses: '2', ties: '0' },
                            streak: { type: 'wins', value: '2' },
                          },
                        },
                      ],
                    },
                    count: 1,
                  },
                },
              ],
            },
          ],
        },
      }),
    }))
    vi.mock('../lib/fetchMyMatchup.js', () => ({
      fetchMyMatchups: vi.fn().mockRejectedValue(new Error('Yahoo matchups request failed: 500')),
    }))

    const { default: freshHandler } = await import('./cron.js')
    const { req, res } = makeReqRes()
    await freshHandler(req, res)

    expect(res.statusCode).toBe(200)
    const { setLatestStandings } = await import('../lib/storage.js')
    const written = (setLatestStandings as any).mock.calls[0][0]
    expect(written.currentMatchup).toBeNull()
    expect(written.lastMatchup).toBeNull()
    expect(written.nextMatchup).toBeNull()
    expect(written.rows).toHaveLength(1)
  })
})
```

(This test uses `vi.mock` at module level with dynamic `import()` inside the test to get fresh mocked
modules per test, since `vi.mock` factories run once per module graph — check the existing test files
in `server/` for whether a different established pattern for mocking `cron.ts`'s dependencies is
already in use, and match that instead if so.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run api/cron.test.ts`
Expected: FAIL — `cron.ts` doesn't yet call `fetchMyMatchups`/`fetchLeagueSettings` at all, so there's
nothing to fail independently; the written payload won't have `currentMatchup`/`lastMatchup`/
`nextMatchup` keys at all yet.

- [ ] **Step 3: Write minimal implementation**

Replace `server/api/cron.ts` with:

```typescript
// server/api/cron.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getStoredRefreshToken,
  setStoredRefreshToken,
  setLatestStandings,
  getCachedLeagueSettings,
  setCachedLeagueSettings,
  type LatestStandingsPayload,
} from '../lib/storage.js'
import { refreshAccessToken } from '../lib/yahoo.js'
import { fetchLeagueStandings } from '../lib/fetchStandings.js'
import { fetchLeagueSettings } from '../lib/fetchLeagueSettings.js'
import { fetchMyMatchups } from '../lib/fetchMyMatchup.js'
import { transformStandings, parseAllTeams, formatRecord } from '../lib/transform.js'
import { parseLeagueSettings, type LeagueSettings } from '../lib/leagueSettings.js'
import { parseMatchups } from '../lib/matchup.js'
import { timingSafeStringEqual } from '../lib/safeCompare.js'

async function resolveLeagueSettings(accessToken: string, leagueKey: string): Promise<LeagueSettings> {
  const cached = await getCachedLeagueSettings()
  if (cached) return cached

  try {
    const raw = await fetchLeagueSettings(accessToken, leagueKey)
    const settings = parseLeagueSettings(raw)
    await setCachedLeagueSettings(settings)
    return settings
  } catch (err) {
    console.error('league settings fetch failed, proceeding without playoff line or categories', err)
    return { categories: [], playoffTeams: null }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const authHeader = req.headers.authorization
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || !timingSafeStringEqual(authHeader ?? '', expected)) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const yahooEnv = {
    clientId: process.env.YAHOO_CLIENT_ID!,
    clientSecret: process.env.YAHOO_CLIENT_SECRET!,
    redirectUri: process.env.YAHOO_REDIRECT_URI!,
  }
  const leagueKey = process.env.YAHOO_LEAGUE_KEY!
  const myTeamKey = process.env.YAHOO_MY_TEAM_KEY!

  try {
    const storedRefreshToken = await getStoredRefreshToken()
    const refreshToken = storedRefreshToken ?? process.env.YAHOO_INITIAL_REFRESH_TOKEN!

    const tokens = await refreshAccessToken(refreshToken, yahooEnv)
    await setStoredRefreshToken(tokens.refreshToken)

    const rawStandings = await fetchLeagueStandings(tokens.accessToken, leagueKey)
    const standings = transformStandings(rawStandings, myTeamKey, new Date().toISOString())

    const settings = await resolveLeagueSettings(tokens.accessToken, leagueKey)

    let currentMatchup: LatestStandingsPayload['currentMatchup'] = null
    let lastMatchup: LatestStandingsPayload['lastMatchup'] = null
    let nextMatchup: LatestStandingsPayload['nextMatchup'] = null
    try {
      const rawMatchups = await fetchMyMatchups(tokens.accessToken, myTeamKey)
      const parsed = parseMatchups(rawMatchups, myTeamKey, settings.categories)
      currentMatchup = parsed.current
      lastMatchup = parsed.last
      if (parsed.next) {
        const allTeams = parseAllTeams(rawStandings)
        const opponentTeam = allTeams.find((t) => t.teamKey === parsed.next!.opponentTeamKey)
        nextMatchup = opponentTeam
          ? {
              opponent: parsed.next.opponent,
              opponentRecord: formatRecord(opponentTeam.wins, opponentTeam.losses, opponentTeam.ties),
            }
          : null
      }
    } catch (err) {
      console.error('matchup fetch failed, proceeding without current/last/next matchup', err)
    }

    const payload: LatestStandingsPayload = {
      ...standings,
      playoffTeams: settings.playoffTeams,
      currentMatchup,
      lastMatchup,
      nextMatchup,
    }

    await setLatestStandings(payload)

    res.status(200).json({ ok: true, asOf: payload.asOf })
  } catch (err) {
    console.error('cron refresh failed', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' })
  }
}
```

Note the standings fetch stays outside any try/catch of its own (other than the outer one) — it was
already mandatory before this change (no standings, no payload at all), and this plan doesn't alter
that.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run api/cron.test.ts`
Expected: PASS. Then run the full suite to confirm nothing else broke:

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: All tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/api/cron.ts server/api/cron.test.ts
git commit -m "feat(server): wire matchup and league-settings fetches into the cron job"
```

---

## Post-Implementation Notes

- The design spec's data contract also names `rows[]` truncation and gap-marker logic as unchanged —
  this plan doesn't touch `transformStandings`'s windowing logic at all, only adds fields to what it
  already produces.
- Every Yahoo-shape assumption in Tasks 6, 8, and 9 needs a real-payload check once Yahoo API access
  clears (per `firmware/HARDWARE_BRINGUP_STATUS.md`) — if field names differ, the fix is localized to
  `parseLeagueSettings`/`parseMatchups`, not a redesign; the rest of the pipeline (types, cron
  orchestration, storage) doesn't need to change.
- This plan does not touch the firmware side at all — see the companion firmware implementation plan
  for parsing these new `latest.json` fields and rendering the two-page layout.
