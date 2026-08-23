# Fantasy Hockey Scoreboard Firmware

## Toolchain

- `arduino-cli` (installed via `brew install arduino-cli`) — 1.5.1
- Core: `esp32:esp32` — 3.3.11
- Libraries: `GxEPD2` (>= 1.6.0 — see design spec for why) — 1.6.9, `ArduinoJson` (^7) — 7.4.3

## One-time setup

1. `cp secrets.h.example secrets.h` and fill in your WiFi credentials, the deployed `/api/standings` URL, the shared token, and your POSIX TZ string.
2. Set driver board DIP switch #1 to "A" (3R) for the 4.2" panel. Leave switch #2 on until firmware is stable (it gates the USB-UART bridge needed for flashing).
3. Confirm the board's 24-pin FFC and e-Paper Adapter are present and connect the panel — the driver board ships without a display.

## Build and flash

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware
arduino-cli upload --fqbn esp32:esp32:esp32 -p <serial-port> firmware
```

Find `<serial-port>` via `arduino-cli board list` with the board plugged in. Depending on board revision this may need a CP2102 or CH343 USB-serial driver installed on macOS — check the chip printed on the board if the port doesn't show up.

## Wiring reference

| Signal | GPIO |
|---|---|
| BUSY | 25 |
| RST | 26 |
| DC | 27 |
| CS | 15 |
| CLK/SCK | 13 |
| DIN/MOSI | 14 |

These are fixed by the driver board (no manual wiring needed) but are
non-standard SPI pins — `display_render.cpp` remaps HSPI to match; do not
"simplify" this to a plain `SPI.begin()`.

## Manual on-device verification

Not automatable — run through this after flashing, both on first bring-up
and after any change to `network_api.cpp` or `display_render.cpp`:

1. **Happy path:** power on with good WiFi and a reachable `/api/standings`. Confirm the table renders with correct ranks/names/records, the gap divider appears in the right place, and your own team's row is visually highlighted.
2. **WiFi failure:** temporarily wrong `WIFI_PASSWORD` in `secrets.h`. Confirm the device gives up after ~30s (not hanging) and deep-sleeps rather than staying awake.
3. **API failure with a cache present:** after a successful run (so NVS has cached data), block `STANDINGS_URL` (e.g. wrong `SHARED_TOKEN` temporarily) and confirm the display shows the previously-cached standings with a "Last updated: ..." footer, not a blank/garbage screen.
4. **Cold start, no cache, API failure:** erase flash (`arduino-cli upload` after `esptool.py erase_flash`, or hold BOOT during a fresh flash) so NVS is empty, then run with a broken `STANDINGS_URL`. Confirm the "No data yet" message renders instead of a blank screen.
5. **Panel care:** confirm via serial log or a logic probe that `hibernate()` is actually reached at the end of every path above, including the WiFi-failure path in step 2.
6. **Sleep duration sanity:** log the computed `sleepMicros` value before `esp_deep_sleep_start()` and confirm it's in a sane range (a few hours to ~24h, never near-zero or absurdly large) for a couple of different times-of-day.
