# Fantasy Hockey E-Ink Scoreboard

An e-paper display that shows your Yahoo Fantasy Hockey standings. Built on a Waveshare 7.5" panel (800×480) and an ESP32.

It wakes up once a day, around 8am. It shows:

- The top of the standings table
- A window around your own team
- A line marking the playoff cutoff
- Your matchups: this week, last week, next week

Then it goes back to sleep.

Press the button to flip to page 2. That page breaks down every stat category for your current matchup.

| Page 1: standings + matchups | Page 2: category breakdown |
|---|---|
| ![Page 1: standings table with playoff line and a this-week/last-week/next-week matchup sidebar](firmware/docs/images/page1-standings.png) | ![Page 2: head-to-head category breakdown with leader markers](firmware/docs/images/page2-categories.png) |

## What you'll need

- [Waveshare ESP32 e-Paper Driver Board](https://www.waveshare.com/e-paper-esp32-driver-board.htm) (has the ESP32 and USB-serial chip built in)
- [Waveshare 7.5" e-Paper raw panel](https://www.waveshare.com/7.5inch-e-paper.htm), 800×480, GDEY075T7 generation, with its 24-pin FFC cable
- A momentary push button
- A USB cable, for power and flashing

Full wiring details are in [firmware/README.md](firmware/README.md).

## How it fits together

```
Yahoo Fantasy API  →  server/  (Vercel, daily cron)  →  Vercel Blob (latest.json)
                                                              ↓
                                            firmware/  (ESP32 + e-paper panel)
```

Two pieces.

**server/** runs on Vercel. A daily cron job pulls standings and matchup data from Yahoo, reshapes it, and saves it to Vercel Blob. The ESP32 reads that file once a day. Setup steps (Yahoo app registration, env vars, deploy) are in [server/README.md](server/README.md).

**firmware/** is the ESP32 sketch. It fetches the saved standings, draws both pages with GxEPD2, and handles deep sleep, offline caching, and the button. Build and flash steps are in [firmware/README.md](firmware/README.md).

`docs/` holds the design specs and plans for both pieces.

## Getting started

1. Deploy the server first. The firmware needs a live `/api/standings` endpoint to talk to.
2. Build and flash the firmware. Point `secrets.h` at your server URL and shared token.
