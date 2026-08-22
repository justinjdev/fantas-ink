# Fantasy Hockey E-Ink Scoreboard — Design

## Overview

A Waveshare 4.2" e-paper display (400x300), driven by a Waveshare Universal e-Paper
Driver Board (ESP32 onboard), wakes once a day at 8am to show the current Yahoo
Fantasy Hockey league standings: top 3 teams plus a window around the user's own
team, then deep sleeps until the next day.

## Hardware

- **MCU:** ESP32 (Waveshare Universal e-Paper Driver Board)
- **Display:** Waveshare 4.2" e-Paper, 400x300, raw SPI panel
- **Display library:** GxEPD2 (Adafruit_GFX rendering)
- **Pinout:** to be confirmed against Waveshare's driver board wiki/schematic during
  implementation. Do not reuse pin numbers from unrelated board/panel combinations.

## Architecture

Two components, split by concern: a companion service that owns all the Yahoo
OAuth/API complexity, and firmware that only renders a precomputed view model.

```
Yahoo Fantasy API  <--OAuth-->  Vercel Cron (daily, ~7:55am)
                                     |
                                     v
                              transforms + writes
                                     |
                                     v
                              Vercel Blob: latest.json
                                     ^
                                     |  GET (shared query-param token)
                                     |
                              ESP32 (daily, ~8:05am)
```

**Companion service (Vercel, free/Hobby tier):**
- A Vercel Cron job (once/day, the Hobby-tier limit — which fits this use case
  exactly) fires ~5 minutes before the ESP32's wake time. It refreshes the Yahoo
  access token from a stored refresh token, calls the Yahoo Fantasy Sports API for
  league standings, and transforms the response into a small precomputed view
  model (see Data Contract below). Result is written to Vercel Blob as
  `latest.json`.
- A separate public `GET /api/standings` endpoint reads and returns the stored
  JSON. It never calls Yahoo live — the ESP32 never blocks on OAuth latency.
- Windowing/dedup logic (top 3 + rank±2, gap-marking) lives server-side so it can
  be tweaked without reflashing firmware.

**Firmware (ESP32, Arduino + GxEPD2):**
- Wakes from deep sleep once daily (~8:05am local), connects WiFi, syncs time via
  NTP. NTP resync each wake corrects ESP32 RTC drift so the next sleep duration
  stays accurate over long deep-sleep periods.
- `GET`s `/api/standings` with retry (3x, backoff) on failure.
- On success: renders the JSON to the display, writes it + timestamp to flash
  (NVS) as last-known-good.
- On failure after retries: renders the cached last-known-good data with a
  "Last updated: [date]" footer instead of an error screen.
- Computes sleep duration until next 8am, deep sleeps.

## Data Contract

`latest.json`, written by the cron job, read by the ESP32:

```json
{
  "asOf": "2026-08-21T11:55:00Z",
  "myTeamKey": "423.l.xxxxx.t.7",
  "rows": [
    { "rank": 1, "name": "Team Name", "wins": 10, "losses": 2, "ties": 0 },
    { "rank": 2, "name": "...", "wins": 9, "losses": 3, "ties": 0 },
    { "rank": 3, "name": "...", "wins": 8, "losses": 4, "ties": 0 },
    { "gap": true },
    { "rank": 6, "name": "...", "wins": 6, "losses": 6, "ties": 0 },
    { "rank": 7, "name": "...", "wins": 6, "losses": 6, "ties": 0 },
    { "rank": 8, "name": "Your Team", "wins": 5, "losses": 7, "ties": 0, "isMe": true },
    { "rank": 9, "name": "...", "wins": 5, "losses": 7, "ties": 0 },
    { "rank": 10, "name": "...", "wins": 4, "losses": 8, "ties": 0 }
  ]
}
```

- `rows` is always top 3 + (user's rank - 2) through (user's rank + 2), deduplicated
  and sorted by rank ascending.
- A `{ "gap": true }` row is inserted where the ranges don't overlap; the firmware
  renders it as a divider (e.g. "···").
- `isMe: true` marks the user's own team; firmware renders it with a visual
  highlight (bold border / inverted row).
- Team names are truncated to fit the column width on-device if needed.

## Failure Handling

- ESP32 retries the standings fetch up to 3x with backoff before giving up.
- On persistent failure, the display keeps showing the last successfully fetched
  data (cached in flash/NVS) with a "Last updated: [date]" footer, rather than an
  error screen. It retries again on the next scheduled wake.
- If the cron job itself fails (Yahoo token refresh error, Yahoo API error), the
  `/api/standings` endpoint continues serving the last successfully written
  `latest.json` — the ESP32's fetch still succeeds, just with stale `asOf`.

## Repository Structure

```
firmware/
  fantasy_hockey_scoreboard.ino   # setup/loop: wake reason, orchestration, deep sleep
  network_api.h/.cpp              # WiFi connect, NTP sync, HTTPS GET + retry, JSON parse
  display_layout.h/.cpp           # renders the rows[] view model to the 400x300 canvas
  secrets.h.example                # WIFI_SSID, WIFI_PASSWORD, STANDINGS_URL, SHARED_TOKEN
  secrets.h                        # gitignored, real values

server/
  api/cron.ts        # Vercel Cron target: refresh Yahoo token, fetch standings, transform, write to Blob
  api/standings.ts    # public GET: reads Blob, returns latest.json (checks shared token)
  lib/yahoo.ts        # OAuth refresh + Fantasy API client
  lib/transform.ts    # raw Yahoo standings -> {asOf, myTeamKey, rows[]} view model
  vercel.json          # cron schedule config
```

`display_layout` knows nothing about Yahoo or HTTP; `network_api` knows nothing
about rendering — same separation the original hardware notes called for, re-scoped
to the 4.2" panel and the new data contract.

## One-Time Manual Setup

Not automatable — requires the user's browser:

1. Register an app on Yahoo Developer Network, get Client ID/Secret.
2. Run the OAuth authorization-code flow once in a browser to obtain an initial
   refresh token.
3. Store Client ID/Secret/refresh token as Vercel environment variables.
4. Flash `secrets.h` with WiFi credentials, the deployed `standings.json` URL, and
   the shared token.

## Testing Approach

- Server: unit test `transform.ts` (raw Yahoo payload → windowed view model,
  including the top-3/neighborhood dedup and gap-marking logic) with fixture JSON
  — this is the one place with real logic worth covering.
- Firmware: no unit tests (embedded). Verify via `arduino-cli compile` for build
  correctness, and manual on-device testing (compile clean, flash, observe actual
  e-ink output) — compilation success alone doesn't confirm correct rendering.

## Out of Scope (YAGNI)

- Live NHL game scores / in-game refresh cadence — this project is standings-only,
  once a day.
- Button-based paging through multiple standings views — the data only changes
  once a day, so paging cached views doesn't add freshness, only firmware
  complexity (extra GPIO wake source, page state persisted across deep sleep).
- Multi-league support, historical trends, or matchup details — single league,
  current standings only.
