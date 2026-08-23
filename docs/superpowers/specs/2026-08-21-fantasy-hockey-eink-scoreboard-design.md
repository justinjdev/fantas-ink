# Fantasy Hockey E-Ink Scoreboard — Design

## Overview

A Waveshare 4.2" e-paper display (400x300), driven by the Waveshare ESP32
e-Paper Driver Board (a standalone board with the ESP32 onboard, not the
Raspberry Pi/Jetson HAT of a similar name), wakes once a day at ~8am to show the current Yahoo
Fantasy Hockey league standings: top 3 teams plus a window around the user's own
team, then deep sleeps until the next day.

**Power:** USB/wall-powered, always plugged in — not battery. (Flagged during
design review: this specific board draws ~10mA even in deep sleep, roughly
1000x a well-behaved ESP32's deep-sleep current, which would only give a few
days per charge on a small cell — a non-issue on wall power.) Deep sleep is
still used, not for battery life, but because it's a clean daily reset:
keeping an ESP32's WiFi stack associated for days at a time is a known source
of slow instability, and e-ink also wants at least one refresh every 24h
regardless (see Hardware section) — deep sleep naturally satisfies both.

## Hardware

- **MCU:** ESP32 (Waveshare ESP32 e-Paper Driver Board)
- **Display:** Waveshare 4.2" e-Paper, 400x300, raw SPI panel. In hand: rev
  2.2 (V2). Confirm on unboxing that the driver board's 24-pin FFC and
  e-Paper Adapter are present — the driver board ships without a display, so
  these don't come from the panel's own packaging.
- **Display library:** GxEPD2 (Adafruit_GFX rendering) — actively maintained
  (v1.6.9). **Pin to >= 1.6.0**, not just "latest at time of writing": two
  bugs specific to this exact panel revision were fixed in that range —
  rev2.2 partial-update garbage (fixed in 1.5.6) and fast-full-refresh
  support for the 2024 panel version (fixed in 1.6.0, per GxEPD2's own
  changelog). The header defaults `useFastFullUpdate = true`, and this
  design does a full refresh every wake, so a pre-1.6.0 library against this
  panel gives a broken refresh with no compile error — a silent-corruption
  trap, not a crash.
- **Panel driver class:** `GxEPD2_420_GDEY042T81` — confirmed against the
  GxEPD2 source (`src/gdey/GxEPD2_420_GDEY042T81.h`, not `src/epd/` where the
  older `GxEPD2_420` class for rev 2.1/V1 panels lives; worth calling out
  since it trips up manual includes). Declares `WIDTH=400`, `HEIGHT=300`,
  monochrome, SSD1683 controller — matches this panel. Two behaviors worth
  carrying into the plan:
  - `useFastFullUpdate` degrades below 0°C (the panel's spec floor) — fine
    for an indoor scoreboard, but set `false` if this ever runs somewhere
    unheated.
  - `hibernate()` only issues the SSD1683 sleep command when `_rst >= 0` —
    since RST is wired to GPIO26 (not omitted), this works as expected, but
    it means a real RST pin is a hard requirement for hibernate to do
    anything at all, not just good practice.
  - Header-declared timing: `full_refresh_time = 1200ms`,
    `power_on_time = 100ms` — useful for sizing the wake-cycle time budget
    below (Waveshare's generic product page quotes ~5s, which overstates it
    for this panel).
- **DIP switches** (on the driver board): switch #1 sets the booster
  current-limit resistor per panel model — must be set to **"A" (3R)** for
  this 4.2" panel; wrong position gives poor/absent output that looks
  identical to a wiring or driver-class bug. Switch #2 gates power to the
  onboard USB-UART bridge (off saves a little power, but you can't reflash
  with it off — leave it on until firmware is stable).
- **Panel care:** per Waveshare's own precaution, leaving the panel powered
  without refreshing "will damage the e-Paper and cannot be repaired" — the
  render step must always end with `display.hibernate()`, and Waveshare
  recommends refreshing at least once per 24h, which the daily wake cycle
  satisfies as long as drift (see Architecture) doesn't push an interval past
  24h.
- **Pinout:** confirmed against Waveshare's ESP32 e-Paper Driver Board wiki and
  GxEPD2's own `ConnectingHardware.md` (the library this project uses), which agree:

  | Signal | GPIO |
  |---|---|
  | BUSY | 25 |
  | RST | 26 |
  | DC | 27 |
  | CS | 15 |
  | CLK/SCK | 13 |
  | DIN/MOSI | 14 |

  These are non-standard SPI pins — GxEPD2's docs note this board "requires
  re-mapping of HW SPI to these pins in `SPIClass`" rather than using the ESP32's
  default VSPI pins. `network_api.cpp`'s display init must construct a remapped
  `SPIClass` (see GxEPD2's example sketch `GxEPD2_WS_ESP32_Driver.ino` for the
  pattern) before handing it to the GxEPD2 driver — a plain `SPI.begin()` will not
  work on this board.

## Architecture

Two components, split by concern: a companion service that owns all the Yahoo
OAuth/API complexity, and firmware that only renders a precomputed view model.

```
Yahoo Fantasy API  <--OAuth-->  Vercel Cron (daily, ~7:30am)
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

The cron-to-wake buffer is 35 minutes, not the originally-proposed 5-10:
the ESP32's deep-sleep RTC runs off an internal oscillator Espressif documents
as temperature-sensitive, and field reports put drift around 8-9
minutes/day. NTP resync each wake (see Firmware below) prevents that drift
from *accumulating* across days, but can't correct drift that already
happened during the sleep just ending — so the wake time itself still jitters
day to day, and needs real margin against the cron write it depends on.

**Companion service (Vercel, free/Hobby tier):**
- A Vercel Cron job (once/day, the Hobby-tier limit — which fits this use case
  exactly) fires ~35 minutes before the ESP32's wake time. It refreshes the Yahoo
  access token from a stored refresh token, calls the Yahoo Fantasy Sports API for
  league standings, and transforms the response into a small precomputed view
  model (see Data Contract below). Result is written to Vercel Blob as
  `latest.json`.
- A separate public `GET /api/standings` endpoint reads and returns the stored
  JSON. It never calls Yahoo live — the ESP32 never blocks on OAuth latency.
- Windowing/dedup logic (top 3 + rank±2, gap-marking) lives server-side so it can
  be tweaked without reflashing firmware.

**Firmware (ESP32, Arduino + GxEPD2):**
- Wakes from deep sleep once daily (~8:05am local), connects WiFi. A hard
  wall-clock budget (e.g. 60s from boot) covers the whole wake cycle —
  `WiFi.begin()` can block indefinitely against a down/renamed AP, and
  without a cap the device stays awake burning full power (not deep-sleep
  current) until the battery/session dies instead of retrying tomorrow.
- Syncs time via NTP using `configTzTime()` with a POSIX TZ string (not just
  NTP's UTC), so "8am local" stays correct across DST transitions. NTP resync
  each wake corrects ESP32 RTC drift so the next sleep duration stays
  accurate over long deep-sleep periods; it must complete before the HTTPS
  fetch below, since TLS certificate validity checks depend on a correct
  system clock.
- `GET`s `/api/standings` over HTTPS (root CA pinned — not a leaf/intermediate
  cert, so the device doesn't brick itself at the next routine cert rotation
  — to **both** ISRG Root X1 and GTS Root R1, concatenated. This spec
  originally claimed Vercel serves a Let's Encrypt/ISRG-rooted chain; that
  was wrong, caught during the firmware's final review by querying the live
  deployment directly with `openssl s_client`, which showed a Google Trust
  Services chain rooted at GTS Root R1 instead. Both roots are pinned
  together so a future Vercel CA change doesn't require a reflash) with
  retry (3x, backoff, skipping retries on 401 since a bad token won't
  succeed on a second attempt) on failure.
- On success: renders the JSON to the display, writes it + timestamp to flash
  (NVS) as last-known-good.
- On failure after retries: renders the cached last-known-good data with a
  "Last updated: [date]" footer instead of an error screen. On first boot
  with nothing cached yet (empty NVS) and a failed fetch, renders an explicit
  "no data yet" screen rather than a blank/garbage one.
- Every render ends with `display.hibernate()` (see Hardware section — this
  isn't optional, it's how the panel avoids damage from sitting powered).
  Note the NVS cache exists only to reconstruct this frame across a reboot;
  e-ink holds its image with zero power, so on a failure the panel is
  already showing yesterday's data even before any of this runs — the redraw
  is just to refresh the "Last updated" footer and satisfy the 24h-refresh
  guidance above.
- Computes sleep duration until next 8am, deep sleeps.
  `esp_sleep_enable_timer_wakeup()` takes microseconds as `uint64_t` — a full
  day in microseconds overflows a 32-bit int, so the calculation must use
  `uint64_t`/`ULL` literals throughout, not `int` arithmetic that happens to
  get implicitly widened. Getting this wrong doesn't fail loudly: the device
  wakes every ~35 minutes instead of once a day, hammering the API and
  burning power in a way that looks nothing like an arithmetic bug.

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
- NVS caps individual string entries at 4000 bytes; the ~9-row payload is
  comfortably under that, and daily writes are a non-issue for flash wear
  (365/year against NVS's ~100k-cycle wear-levelled budget). No special
  handling needed, just don't grow the cached payload unboundedly.

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

Not automatable — requires the user's browser, hands-on-hardware, or both:

1. Register an app on Yahoo Developer Network, get Client ID/Secret.
2. Run the OAuth authorization-code flow once in a browser to obtain an initial
   refresh token.
3. Store Client ID/Secret/refresh token as Vercel environment variables.
4. Set driver board DIP switch #1 to "A" (3R) for this panel; leave #2 on
   until firmware is stable and reflashing is no longer needed regularly.
5. Flash `secrets.h` with WiFi credentials, the deployed `standings.json` URL, and
   the shared token.

## Testing Approach

- Server: unit test `transform.ts` (raw Yahoo payload → windowed view model,
  including the top-3/neighborhood dedup and gap-marking logic) with fixture JSON
  — this is the one place with real logic worth covering.
- Firmware: mostly embedded, but `display_layout.cpp`'s layout logic (gap-row
  placement, name truncation to column width, `isMe` highlighting) is pure
  logic over Adafruit_GFX calls with no hardware dependency — it compiles and
  unit-tests natively on the host against a stub GFX, and is the code most
  likely to be subtly wrong, so it gets real test coverage rather than being
  lumped in with "no unit tests (embedded)."
- Everything else in firmware (WiFi/NTP/fetch/deep-sleep orchestration):
  verify via `arduino-cli compile` for build correctness, plus manual
  on-device testing — not just the happy path, but forced-failure runs (WiFi
  down, API returning 500, first boot with empty NVS) since that's where the
  interesting failure-handling logic actually lives. Compilation success
  alone confirms none of this.

## Out of Scope (YAGNI)

- Live NHL game scores / in-game refresh cadence — this project is standings-only,
  once a day.
- Button-based paging through multiple standings views — the data only changes
  once a day, so paging cached views doesn't add freshness, only firmware
  complexity (extra GPIO wake source, page state persisted across deep sleep).
- Multi-league support, historical trends, or matchup details — single league,
  current standings only.
