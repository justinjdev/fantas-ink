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

## Host tests

Two pure modules (`sleep_util` and `display_layout`) have no Arduino
dependencies and are tested by compiling them on the host — no board needed:

```bash
clang++ -std=c++17 firmware/test/sleep_util_test.cpp firmware/sleep_util.cpp -o /tmp/sleep_util_test && /tmp/sleep_util_test
clang++ -std=c++17 firmware/test/display_layout_test.cpp firmware/display_layout.cpp -o /tmp/display_layout_test && /tmp/display_layout_test
```

Each prints its test names and `OK`, and exits non-zero on failure. Run both
from the repository root before flashing. Everything else (network, NVS,
panel) needs the manual pass below.

## Manual on-device verification

Not automatable — run through this after flashing, both on first bring-up
and after any change to `network_api.cpp` or `display_render.cpp`.

Attach a serial monitor at 115200 baud (`arduino-cli monitor -p <serial-port>
-c baudrate=115200`) before powering on — every step below is confirmed from
the log lines the firmware prints.

1. **Happy path:** power on with good WiFi and a reachable `/api/standings`. Expect `WiFi connected`, a `Budget: <n> ms remaining for fetch` line, and `Data source: fresh fetch (<n> rows)`. Confirm the table renders with correct ranks/names/records, the gap divider appears in the right place, and your own team's row is visually highlighted.
2. **WiFi failure:** temporarily wrong `WIFI_PASSWORD` in `secrets.h`. Expect `WiFi connect failed` after ~30s (not hanging), then the display and sleep lines below — the device must deep-sleep rather than staying awake.
3. **API failure with a cache present:** after a successful run (so NVS has cached data), block `STANDINGS_URL` (e.g. wrong `SHARED_TOKEN` temporarily) and expect `Fetch: attempt 1 failed with status 401` followed immediately by `Data source: NVS cache (<n> rows)` — note a 401 is deliberately not retried. Confirm the display shows the previously-cached standings with a "Last updated: ..." footer, not a blank/garbage screen.
4. **Cold start, no cache, API failure:** erase flash (`arduino-cli upload` after `esptool.py erase_flash`, or hold BOOT during a fresh flash) so NVS is empty, then run with a broken `STANDINGS_URL`. Expect `Data source: none — rendering 'No data yet'` and the "No data yet" message on the panel instead of a blank screen.
5. **Panel care:** confirm `Display: hibernating panel` appears at the end of every path above, including the WiFi-failure path in step 2. This is the last thing logged before the sleep lines, so its absence means `hibernate()` was skipped.
6. **Time budget:** in step 3, confirm the whole wake cycle stays within ~60s. If retries run long you will see `Fetch: time budget exhausted, giving up`; that line is the budget working as intended, not a failure.
7. **Sleep duration sanity:** the last two lines of every run are one of `Sleep: clock synced, scheduling next 8am wake` / `Sleep: clock never synced, using 1h retry fallback`, then `Sleep: sleepMicros=<n> (<h> hours)`. Confirm the value is in a sane range (never near-zero or absurdly large) for a couple of different times-of-day. **Exactly 1.00 hours is legitimate, not a bug:** it is the clock-never-synced fallback, and the preceding line tells you which branch produced the value. With a synced clock expect a few hours up to ~24h depending on time-of-day.
