# Fantasy Hockey E-Ink Scoreboard

A Waveshare 7.5" e-paper display (800×480), always-on wall power, that wakes
once a day at ~8am to show the current Yahoo Fantasy Hockey league standings —
top of the table, a window around your own team, a playoff-line divider, and
a this-week/last-week/next-week matchup sidebar — then deep sleeps until the
next day. A physical button toggles to a second page with a full head-to-head
category breakdown for the current matchup. Confirmed working on real
hardware.

| Page 1 — standings + matchup summary | Page 2 — category breakdown |
|---|---|
| ![Page 1: standings table with playoff line and a this-week/last-week/next-week matchup sidebar](firmware/docs/images/page1-standings.png) | ![Page 2: head-to-head category breakdown with leader markers](firmware/docs/images/page2-categories.png) |

## How it fits together

```
Yahoo Fantasy API  →  server/  (Vercel, daily cron)  →  Vercel Blob (latest.json)
                                                              ↓
                                            firmware/  (ESP32 + e-paper panel)
```

- **`server/`** — a Vercel-hosted TypeScript backend. A daily cron job pulls
  standings and matchup data from the Yahoo Fantasy API, transforms it, and
  publishes it to Vercel Blob. The ESP32 fetches from `/api/standings` on its
  own daily wake cycle. See [`server/README.md`](server/README.md) for setup
  (Yahoo app registration, env vars, deployment).
- **`firmware/`** — the ESP32 Arduino sketch that fetches the published
  standings, renders both pages via GxEPD2, and manages deep sleep, NVS
  caching for offline fallback, and the page-toggle button. See
  [`firmware/README.md`](firmware/README.md) for the toolchain, build/flash
  steps, wiring reference, and manual verification checklist.
- **`docs/`** — design specs and implementation plans for both halves of the
  project.

## Getting started

1. Set up and deploy the server first (`server/README.md`) — the firmware
   needs a live `/api/standings` endpoint to fetch from.
2. Build and flash the firmware (`firmware/README.md`), pointing `secrets.h`
   at your deployed server URL and shared token.
