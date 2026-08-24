# Standings Display Redesign — Design

Supersedes the rendering portions of the original
[2026-08-21 design spec](./2026-08-21-fantasy-hockey-eink-scoreboard-design.md) for the new 7.5"
panel (800×480 — see `firmware/HARDWARE_BRINGUP_STATUS.md` for why the panel changed). That spec's
Hardware, Architecture, Repository Structure, and Testing Approach sections still apply; this doc
covers everything that changed about *what's shown and how*.

## Motivation

The original 400×300 layout, ported as-is to the new 800×480 canvas, used roughly 40% of the width
and 50% of the height — small text, huge margins, one flat table. This redesign uses the extra space
deliberately rather than just stretching the old layout, and adds data (win%, streak, current
matchup) that's worth showing now that there's room for it.

This design was worked out interactively as a set of pixel-accurate HTML/canvas mockups (published
as Claude Artifacts, not stored in this repo — links below are to the private Artifact pages from
that session, viewable by the account that created them). The final approved version, after several
rounds of feedback, is at `https://claude.ai/code/artifact/d26fb8bd-660b-47f0-9b35-056de9878bfe`;
everything in this doc reflects that version.

## Scope

**In scope**, decided over this session's brainstorm:
- Same 9-row standings window (top 3 + 5 around the user's team) — no change to `transform.ts`'s
  windowing/dedup logic or row count.
- Two new per-row fields: win percentage (computed, not trusted from an assumed Yahoo field) and
  streak (parsed from Yahoo, new field).
- League name, sourced from the same standings response.
- Current week's matchup (in-progress, still refreshed once daily — not live), last week's final
  matchup, **and** next week's scheduled opponent — three matchup states in the sidebar, unequally
  weighted (40% current / 30% last / 30% next), not the equal current/last split floated earlier in
  the session.
- A full head-to-head category breakdown (goals, assists, hits, etc.) for the current matchup, as a
  second page.
- A physical momentary push-button to toggle between the two pages.
- A playoff cutoff line in the standings table, visually distinct from the ordinary windowed-gap
  divider.

**Explicitly still out of scope** (unchanged from the original spec): live/in-game refresh cadence,
more than the 9-row window, full league standings, other teams' matchup results, games back, points
for/against.

**Reverses a prior YAGNI call.** The original spec's Out of Scope section rejected "button-based
paging through multiple standings views... only adds firmware complexity (extra GPIO wake source,
page state persisted across deep sleep)." That reasoning was sound for its premise — paging *cached*
views of the same once-daily data doesn't add freshness. What changed: the category breakdown
(~13 rows) genuinely doesn't fit on the same screen as the standings table without crowding out both,
so a second page is now serving distinct content, not just re-paginating the same view. The technical
complexity flagged back then is real and is designed for below, not waved away.

## Data Contract

`latest.json`, extended:

```json
{
  "asOf": "2026-08-23T11:55:00Z",
  "myTeamKey": "423.l.xxxxx.t.7",
  "leagueName": "Backyard Rink Legends",
  "playoffTeams": 6,
  "rows": [
    { "rank": 1, "name": "Zamboni Drivers", "wins": 10, "losses": 2, "ties": 0, "winPct": ".833", "streak": "W4" },
    { "rank": 2, "name": "Puck Norris", "wins": 9, "losses": 3, "ties": 0, "winPct": ".750", "streak": "W2" },
    { "rank": 3, "name": "Slapshot Kings", "wins": 8, "losses": 4, "ties": 0, "winPct": ".667", "streak": "L1" },
    { "gap": true },
    { "rank": 6, "name": "Ice Capades", "wins": 6, "losses": 6, "ties": 0, "winPct": ".500", "streak": "W1" },
    { "rank": 7, "name": "Blueline Bandits", "wins": 6, "losses": 6, "ties": 0, "winPct": ".500", "streak": "L3" },
    { "rank": 8, "name": "Cellar Dwellers", "wins": 5, "losses": 7, "ties": 0, "winPct": ".417", "streak": "L2", "isMe": true },
    { "rank": 9, "name": "Odd Man Rush", "wins": 5, "losses": 7, "ties": 0, "winPct": ".417", "streak": "W1" },
    { "rank": 10, "name": "Empty Netters", "wins": 4, "losses": 8, "ties": 0, "winPct": ".333", "streak": "L4" }
  ],
  "currentMatchup": {
    "opponent": "Ice Capades",
    "status": "AHEAD",
    "tally": "7-5-1",
    "categories": [
      { "label": "G", "mine": 14, "theirs": 10, "higherWins": true },
      { "label": "GAA", "mine": 2.85, "theirs": 2.60, "higherWins": false }
    ]
  },
  "lastMatchup": {
    "opponent": "Puck Norris",
    "status": "LOST",
    "tally": "3-5-1"
  },
  "nextMatchup": {
    "opponent": "Blueline Bandits",
    "opponentRecord": "6-6-0"
  }
}
```

`categories` above is abbreviated to two entries for readability — one entry per league scoring
category in the real payload, one per row of the placeholder set (13; see Open Items).

Field notes:
- `winPct`: computed server-side from `wins`/`losses`/`ties` (already reliably parsed), not read from
  an assumed Yahoo `percentage` field — avoids depending on an unconfirmed API shape.
- `streak`: read from Yahoo's `team_standings.streak` (`{type, value}`), formatted to `"W4"`/`"L2"`/`"T1"`.
- `leagueName`: read via the existing `findByKey` helper (`server/lib/yahooJson.ts`) called on the
  **full raw response**, not the narrower `teamsContainer` already scoped inside `parseAllTeams`.
  `findByKey` does a first-match-by-key-name search — `name` exists on every team too, so calling it
  from inside the teams subtree would silently return a team's name instead of the league's. Must be
  called at the top of `transformStandings`, before descending into teams.
- `currentMatchup` / `lastMatchup` / `nextMatchup`: independently nullable. `null` on a bye week,
  before/after the season's matchup schedule, or if the corresponding Yahoo fetch fails — the firmware
  must render a plain fallback in each case, not blank space or a parse error (see Error Handling).
  `nextMatchup` has no `status`/`tally` (the game hasn't happened) — just `opponent` and
  `opponentRecord`, so it needs its own type rather than reusing `MatchupSummary` as-is (see Firmware
  Changes).
- `nextMatchup.opponentRecord`: the opponent may not be one of the 9 teams in `rows[]`, but their
  record is available without an extra fetch — `transform.ts` already parses every team's full record
  before windowing down to the displayed 9 (see `parseAllTeams` in the original spec's server code);
  this just exposes one more of those already-parsed records.
- `playoffTeams`: the rank of the last team to make the playoffs. Drives the playoff-line divider in
  the table (see Firmware Changes) — `null`/absent if league settings couldn't be fetched, in which
  case the table renders without a playoff line rather than guessing.
- `categories[].higherWins`: server-supplied per category rather than a hardcoded firmware lookup
  table, since the category set itself is league-configured (see Server Changes) and self-describing
  data is simpler than keeping a stat-semantics table in sync between server and firmware. `GAA` is
  the one lower-is-better category in the standard set; everything else here is higher-is-better.
- A tie (`mine === theirs`, direction-adjusted) marks neither side as leading — both values render
  plain, no bold, no marker. Intentional, not a gap in the leader logic.
- **Free-text fields need ASCII sanitization server-side.** `leagueName` and every `rows[].name` are
  user-chosen Yahoo team/league names — plausibly containing emoji or accented characters, unlike the
  UI's own fixed strings. The vendored fonts only cover `0x20`–`0x7E` (see the font-coverage note
  under Rendering below), so unsanitized text risks silent mis-render, not just a cosmetic quirk. Best
  handled in `transform.ts`: transliterate/strip to ASCII before writing `latest.json`, so firmware
  always receives text it can actually draw rather than needing its own fallback logic per glyph.

## Server Changes

- `fetchMyMatchup.ts` (new): calls Yahoo's `/team/{myTeamKey}/matchups`, scoped to just the user's
  team rather than the full league scoreboard (matches the "just my team" decision from earlier in
  this session — smaller payload, no filtering-out-other-teams logic needed). One call can return
  multiple weeks, so `currentMatchup` (`status: midevent`), `lastMatchup` (`status: postevent`, most
  recent), and `nextMatchup` (`status: preevent`, soonest scheduled) likely all come from this single
  request — not three separate calls. Needs confirming once Yahoo API access clears that `preevent`
  matchups are actually included in the default response (vs. needing an explicit week range).
- Category labels and per-category direction (`higherWins`), **and** `playoffTeams`, require Yahoo's
  league **settings** resource (`stat_categories` with `sort_order`, plus the playoff bracket size),
  which is a separate call from matchups. Unlike standings/matchups, this rarely changes mid-season —
  fetch and cache it once (e.g. alongside `latest.json` in Blob storage) rather than on every cron
  run, to avoid an unnecessary daily call.
- `nextMatchup.opponentRecord` doesn't need its own fetch — `parseAllTeams` already parses every
  team's full record before `transformStandings` windows it down to the displayed 9, so the next
  opponent's record (even if they're not one of the 9 visible rows) is already sitting in memory at
  the point `nextMatchup` is being built; just look it up by team key instead of re-fetching.
- `transform.ts`: `parseTeam` extracts `streak`; `winPct` is computed, not parsed; new
  `parseMyMatchup` builds `currentMatchup`/`lastMatchup` from the matchups response, joined against
  the cached category settings for labels/`higherWins`.
- `cron.ts`: matchup and settings fetches are additive to the existing standings fetch. Either failing
  independently logs and writes `null` for the corresponding field(s) rather than failing the whole
  run — same non-blocking philosophy already used for the standings-only path today. If category
  settings specifically are unavailable, `currentMatchup.categories` is omitted (see Error Handling)
  even if the matchup summary itself (`status`/`tally`) succeeded.

## Firmware Changes

### Data model
- `StandingsRow`/`LayoutRow` gain `winPct`, `streak` (both short pre-formatted strings, pass through
  unchanged — no truncation logic needed, unlike team names).
- New `MatchupSummary` (`opponent`, `status`, `tally`, a presence flag) for `lastMatchup`, and a
  `CurrentMatchup` extending it with a `vector<CategoryStat>` (`label`, `mine`, `theirs`,
  `higherWins`) for `currentMatchup`. `nextMatchup` needs its own smaller type (`opponent`,
  `opponentRecord`, presence flag) — no `status`/`tally` fields, since nothing's been played yet;
  reusing `MatchupSummary` with those fields blank would let a bug leave stale/default values where
  "not applicable" should be structurally impossible.
- `playoffTeams` (`int`, absent = no playoff line) added alongside the existing top-level fields.
- `parseStandingsJson` (`network_api.cpp`) extends to read the new row fields and both top-level
  matchup objects; absent/`null` matchup fields parse to a default (not-present) struct, not a parse
  failure — the existing empty-rows/missing-`asOf` failure check is unaffected.
- NVS caching (`nvs_cache.cpp`) needs no changes: it already stores `rawJson` verbatim and re-parses
  it on the cached-fallback path, so the new fields ride along automatically once
  `parseStandingsJson` understands them.

### Rendering (`display_render.cpp`)
Full rewrite of `renderLayout()`, now producing two pages. Constants below come directly from the
approved mockup (linked above) — canvas-approximated fonts stood in for the real vendored ones, so
positions/proportions are the actual decision; exact values may need small adjustment once checked
against real `GxEPD2`/`Adafruit_GFX` font metrics on-device.

**New fonts** (`Fonts/FreeSansBold{9,12,18,24}pt7b.h`, `Fonts/FreeMonoBold{9,12,18}pt7b.h` — all
already vendored in `Adafruit_GFX_Library`, no new dependency): `FreeSansBold` for names/labels/
headers, `FreeMonoBold` for every numeric column (rank, W-L-T, win%, streak, category values) — fixed
pitch keeps digits aligned column-to-column without measuring text per row.

**New drawing primitive:** the `isMe` row highlight changes from a border rect (`drawRect`) to an
inverted band — `fillRect` in black, then white text on top. Not used anywhere in the current
renderer.

**Page 1 — standings + matchup summary** (800×480):
- Header: `leagueName` (measured with `getTextBounds` and truncated to the available pixel width if
  needed, same width-based fit as team names) at (20, 40), 24pt bold. Rule at y=54, full width.
- Vertical divider at x=460, y 64–452, separating table (left) from sidebar (right).
- Table: top=74, row height 40, columns at x = {rank: 20, team: 56, W-L-T: 235, win%: 315,
  streak: 385}. Gap row: a plain 1px rule at the row's vertical midpoint instead of text. `isMe` row:
  inverted band, x 16–448.
- **Playoff line:** when a row's rank is exactly `playoffTeams + 1` *and* it directly follows a real
  row (not a windowed gap — if the boundary itself falls inside a gap, there's nothing meaningful to
  draw), render a **dashed** divider (short horizontal segments, thicker than the plain 1px gap rule)
  across the table's row width instead of the normal row content boundary. Deliberately a pattern
  change, not a solid rule plus a text label — an earlier version paired a solid rule with a
  "PLAYOFF LINE" label crammed into the same row, which visually collided with the row above it. The
  dashed pattern alone reads as "a different kind of line" without needing to fight for vertical
  space. No line at all if `playoffTeams` is absent (see Error Handling).
- Sidebar (x 484–780), split **unequally**, not evenly: 40% "THIS WEEK" (current matchup — status
  word AHEAD/BEHIND/TIED, opponent, tally, caption) on top, then 30% "LAST WEEK" (WON/LOST/TIED,
  opponent, tally) and 30% "NEXT WEEK" (opponent, opponent's record — no status/tally, nothing's
  happened yet) as smaller matched-pair blocks below, each separated by a horizontal rule. This
  went through two revisions: first an even current/last 50/50 split, which duplicated the user's
  own W-L-T/win% from the highlighted table row (fixed by making the sidebar 100% matchup content,
  with streak moved into the table as a column for every row, not just the user's); then a redesign
  from 50/50 to 40/30/30 specifically so "this week" — the whole reason for this redesign's
  matchup-first priority — visually dominates instead of reading as equal to a stale last-week
  result. All three header labels ("THIS WEEK"/"LAST WEEK"/"NEXT WEEK") sit at the same fixed offset
  from their own band's top edge — an earlier draft used a larger offset for the big block than the
  two small ones, which read as uneven spacing once compared side by side.
- Footer: rule at y=452, then "Last updated: ..." (only for stale/cached data, same conditional as
  today) bottom-left at y=468, and a page indicator ("PAGE 1/2 - button > categories") bottom-right —
  consistently placed across both pages (an earlier draft had page 2's indicator at the top; moved to
  match page 1 since neither page's header has room to spare and bottom-right doesn't compete with
  either page's primary content).

**Page 2 — category breakdown** (800×480):
- Header: "vs {opponent}" at (20, 38), 18pt bold; status + tally line below at 22pt. Rule at y=88.
- Column headers (my team name right-aligned at x=300, opponent name left-aligned at x=500) then a
  rule at y=118.
- Category table, y 118–452: **row height is computed from `categories.size()` against that fixed
  118–440 budget, not hardcoded** — the real category count depends on league settings and won't
  always be 13. (An early draft hardcoded the row height, which made a 13-row table run into the
  footer's rule and "Last updated" text — this is the fix, and the reason it must stay computed, not
  reverted to a constant.) Each row: my value right-aligned at x=300 (bold + `>` marker if leading),
  category label centered at x=400, their value left-aligned at x=500 (bold + `<` marker if leading).
  Markers and separators are plain ASCII (`>`/`<`/`-`), not the Unicode triangles/middle-dot the
  mockup used at first — the vendored `FreeSansBold`/`FreeMonoBold` fonts only cover `0x20`–`0x7E`
  (confirmed from the font headers' `{Bitmap, Glyph, first, last, yAdvance}` struct), so anything
  outside plain ASCII silently fails to render on real hardware. Caught during a UX pass on the
  approved mockup, before this became firmware code.
- Same footer treatment as page 1: rule at y=452, "Last updated" bottom-left, "PAGE 2/2 - button >
  standings" bottom-right.

### Button / wake architecture
- A momentary push-button wakes the ESP32 from deep sleep via `EXT0` on an RTC-capable GPIO. Exact
  pin TBD — needs to avoid the display's pins (25, 26, 27, 15, 13, 14, 12) and the ESP32's strapping
  pins (notably GPIO0 and GPIO12, which affect boot mode / flash voltage) — can't be finalized without
  the physical board's free headers in hand, same "verify on hardware" caveat as the font-metric
  numbers above.
- Which page is showing is a single `RTC_DATA_ATTR int`, not NVS: RTC memory survives deep sleep and
  costs nothing per write, whereas NVS flash has bounded write endurance that a repeatedly-pressed
  button would chew through much faster than the existing once-daily write.
- **Important correction from how this was described during the mockup walkthrough:** a button wake
  does *not* redraw from still-resident RAM — deep sleep wipes normal RAM, only the tiny RTC memory
  region survives. A button wake re-parses the existing NVS-cached `rawJson` (the same
  `parseStandingsJson`/`loadCachedStandings` path already used for the WiFi-failure fallback today),
  then renders whichever page the RTC flag selects. Still no WiFi/network fetch, still fast (a JSON
  reparse, not a network round-trip) — just not literally "data already in memory."
- On the **daily timer wake** specifically, the page flag resets to page 1 regardless of whatever it
  was left at — every morning refresh starts back at the primary view.
- `EXT0` wake is level-triggered, not edge-triggered. After rendering a button-triggered wake, the
  firmware must confirm the pin has returned to its idle level (poll briefly, with a timeout) before
  calling `esp_deep_sleep_start()` again — otherwise a held or bouncing button can trigger an
  immediate re-wake, causing a rapid render-sleep-render loop instead of one clean toggle. This is a
  real requirement, not a nice-to-have: the original spec already flags this board's elevated ~10mA
  deep-sleep draw as a known concern, and a debounce bug here would make it worse.

## Error Handling

Extends the original spec's Failure Handling section, doesn't replace it — WiFi/fetch retry, NVS
cache fallback, and the "no data yet" cold-start case are all unchanged.

- `currentMatchup`, `lastMatchup`, or `nextMatchup` individually `null` → the corresponding sidebar
  band on page 1 renders a plain fallback line ("No matchup this week"/"No result last week"/"No
  matchup scheduled"), not blank space. Each is independent — losing one doesn't blank the others.
- `playoffTeams` absent → the table renders with no playoff-line divider at all, not a guessed or
  omitted-but-expected line. Silence here is correct: a wrong playoff line (drawn at the wrong rank)
  would be worse than none.
- `currentMatchup` present but `categories` omitted (settings fetch failed) → page 2 renders a plain
  fallback ("Category breakdown unavailable") instead of an empty or garbled table. Page 1 is
  unaffected either way, since it only uses `status`/`tally`, not `categories`.
- Button-wake NVS parse failure (cache was cleared or corrupted between the last timer wake and this
  button press) → falls back to the same "No data yet" message the cold-start path already uses.

## Testing

Extends the original spec's Testing Approach; the two pure-function host tests remain the model:

- `display_layout_test.cpp`: new pass-through cases for `winPct`/`streak`.
- New host test for `transform.ts`'s win% computation and streak formatting (pure functions, no
  network) — same pattern as the existing `sleep_util`/`display_layout` host tests.
- Category-table row-height computation (`(tableBottom - tableTop) / categories.size()`) is a pure
  function worth a host test across a few category counts (including the placeholder 13 and a smaller
  count), specifically to guard against the footer-overlap bug this design already hit once during
  mockup iteration.
- `myMatchup`/category parsing (both server and firmware sides) can't be meaningfully unit-tested
  without a real sample Yahoo payload — flagged for manual sanity-check once Yahoo API access clears
  (still pending, per the bring-up doc), same caveat as the rest of the Yahoo integration today.
- Manual checklist (firmware/README.md) gains: `currentMatchup`/`lastMatchup`/`nextMatchup` each
  `null` rendering, `categories` omitted rendering, `playoffTeams` absent rendering, and a physical
  button-press check once hardware allows it (does the page actually toggle, does it toggle back
  cleanly without a debounce loop, does a daily timer wake correctly reset to page 1 regardless of
  what the button left it on).

## Open Items (verify once testable)

- Button GPIO pin — needs the physical board in hand.
- Real category list and `higherWins` directions — placeholder standard set (G, A, +/-, PIM, PPP,
  SOG, FW, HIT, BLK, W, GAA, SV%, SHO) until Yahoo API access clears and real league settings can be
  queried.
- Whether Yahoo's matchups response actually includes a `preevent` (not-yet-started) entry by default,
  needed for `nextMatchup` — assumed but unconfirmed until Yahoo API access clears.
- Real `playoffTeams` value and where exactly it lives in the league settings resource — placeholder
  of 6 used throughout the mockup.
- Exact column/row pixel constants — decided at the proportions/structure level against
  canvas-approximated fonts; needs a pass against real on-device `getTextBounds()` once the panel and
  vendored fonts can be tested together.
- Category count ceiling — 13 categories is the safe maximum at the font sizes in play: `categoryRowHeight`
  has no floor, and the 118–440 budget gives 24.77px per row at 13 against `FreeMono12pt7b`'s 24px line
  height, but 14 categories drops it to 23.0px and rows begin to overlap. Whoever fills in the real league
  category list should check it against this.
