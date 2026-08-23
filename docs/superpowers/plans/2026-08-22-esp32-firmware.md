# ESP32 Firmware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ESP32 firmware that wakes once daily, fetches precomputed fantasy hockey standings from the already-deployed companion service, renders them to a Waveshare 4.2" e-ink panel, and deep-sleeps until the next day.

**Architecture:** An Arduino (`arduino-cli`) sketch split into single-responsibility modules: two pure/host-testable modules (sleep-duration math, JSON-row-to-display-row transform) and three hardware-dependent modules (e-ink rendering, WiFi/HTTPS/NTP networking, NVS caching), wired together by a thin orchestrating `.ino`.

**Tech Stack:** C++17 (Arduino framework), GxEPD2 (e-ink driver), ArduinoJson (JSON parsing), ESP32 Arduino core (WiFi, HTTPClient, Preferences, deep sleep). Host-side pure-logic tests compile and run directly with `clang++`/`g++` — no Arduino toolchain needed for those two modules.

## Global Constraints

Copied from `docs/superpowers/specs/2026-08-21-fantasy-hockey-eink-scoreboard-design.md` (as revised after design review) — every task's requirements implicitly include these:

- **Board:** Waveshare ESP32 e-Paper Driver Board. **Panel:** Waveshare 4.2" e-Paper, rev 2.2 (confirmed in hand), 400x300, monochrome, SSD1683 controller.
- **GxEPD2 driver class:** `GxEPD2_420_GDEY042T81` (in `src/gdey/`, not `src/epd/`). **Version floor: GxEPD2 >= 1.6.0** — two bugs specific to this exact panel revision (rev2.2 partial-update garbage, broken fast-full-refresh) were fixed at 1.5.6 and 1.6.0 respectively; target the current release (1.6.9 at time of writing, confirm current via `arduino-cli lib search` in Task 1).
- **Pin mapping (confirmed against Waveshare's wiki + GxEPD2's `ConnectingHardware.md`):** BUSY=GPIO25, RST=GPIO26, DC=GPIO27, CS=GPIO15, CLK/SCK=GPIO13, DIN/MOSI=GPIO14. These are non-standard SPI pins (SCK/MOSI swapped from the ESP32's default VSPI) — display init must construct a remapped `SPIClass(HSPI)` bus, not call plain `SPI.begin()`.
- **DIP switch #1** on the driver board must be set to **"A" (3R)** for this panel (physical hardware step, not firmware — documented in README).
- **Power:** USB/wall-powered, not battery. Deep sleep is used for WiFi-stack-stability and the panel's 24h-refresh guidance, not battery life.
- **`display.hibernate()` is mandatory after every render** — Waveshare's own documentation states an unrefreshed, still-powered panel "will damage the e-Paper and cannot be repaired."
- **Wake target: ~8:00am local, daily.** The server's cron (already deployed, separate repo area) fires ~7:30am — a 35-minute buffer chosen against ESP32's documented RTC drift (~8-9 min/day), which NTP-per-wake corrects going forward but cannot correct retroactively for the sleep just ending.
- **Sleep duration must be computed as `uint64_t` microseconds throughout** — `esp_sleep_enable_timer_wakeup()` takes `uint64_t`, and a 24h duration in microseconds (86,400,000,000) overflows a 32-bit `int`.
- **TLS: root CA pinned to ISRG Root X1** (`root_ca.h`) — no `setInsecure()`. NTP sync must complete before any HTTPS fetch, since certificate validity checks need a correct system clock.
- **Timezone:** POSIX TZ string via `configTzTime()`, supplied in `secrets.h` as `TZ_STRING` (user/location-specific — not hardcoded in source).
- **Data contract:** `rows[]` in the fetched JSON is already windowed (top 3 + rank±2), deduplicated, gap-marked (`{"gap": true}`), and sorted by the server (`transform.ts`, already built and deployed). Firmware must **not** re-derive this — it only truncates names for display width and renders.
- **NVS:** individual string entries cap at 4000 bytes; the ~9-row cached payload is comfortably under that — no special bounding logic needed, just don't grow the cached payload unboundedly.
- **Wake-cycle time budget:** WiFi connect has its own timeout (30s) inside an overall ~60s wake-cycle budget, so a down/renamed AP can't keep the device awake indefinitely burning full (non-sleep) power.
- **Testing split, per the spec:** `sleep_util` and `display_layout`'s `buildLayout()` are pure logic with zero Arduino/hardware dependency — they get real host-compiled unit tests. Everything touching WiFi/HTTPS/GxEPD2/NVS is verified via `arduino-cli compile` (build correctness) plus manual on-device testing (including forced-failure runs, not just the happy path) — compilation success alone does not confirm correct behavior there.

## File Structure

This plan splits the design spec's single `display_layout.h/.cpp` into two files, per the spec's own testing guidance (pure layout logic vs. hardware drawing calls are different testability classes and belong in different files):

- `firmware/fantasy_hockey_scoreboard.ino` — `setup()`/`loop()`: orchestrates one wake cycle end-to-end, computes next sleep duration, deep-sleeps. `loop()` is never reached.
- `firmware/secrets.h.example` — template for WiFi creds, standings URL, shared token, TZ string. `firmware/secrets.h` (gitignored) holds the real values.
- `firmware/.gitignore` — excludes `secrets.h` and build output.
- `firmware/root_ca.h` — pinned ISRG Root X1 certificate for TLS.
- `firmware/sleep_util.h` / `.cpp` — **pure.** Computes microseconds until the next daily wake time.
- `firmware/display_layout.h` / `.cpp` — **pure.** `StandingsRow`/`LayoutRow` types and `buildLayout()` (name truncation, gap/isMe passthrough). No Arduino or GxEPD2 dependency — compiles and tests natively on the host.
- `firmware/display_render.h` / `.cpp` — **hardware-dependent.** Display init (remapped SPI, pin config), table rendering, full-screen message rendering, hibernate. Compile-verified only.
- `firmware/nvs_cache.h` / `.cpp` — last-known-good JSON cache backed by the `Preferences` library (NVS).
- `firmware/network_api.h` / `.cpp` — WiFi connect, NTP/TZ sync, HTTPS fetch with retry + pinned CA, JSON parsing into `StandingsRow`.
- `firmware/test/test_utils.h` — tiny shared `CHECK_EQ`/`RUN` macros for the two host-tested modules (no external test framework dependency — a handful of assertions doesn't justify one).
- `firmware/test/sleep_util_test.cpp`, `firmware/test/display_layout_test.cpp` — host tests.
- `firmware/README.md` — toolchain setup, pinned library/core versions, DIP switch and wiring notes, flashing and deployment checklist.

---

### Task 1: Firmware scaffold and toolchain

**Files:**
- Create: `firmware/.gitignore`
- Create: `firmware/secrets.h.example`
- Create: `firmware/root_ca.h`
- Create: `firmware/fantasy_hockey_scoreboard.ino`
- Create: `firmware/README.md`

**Interfaces:**
- Produces: a `firmware/` directory where `arduino-cli compile` succeeds for a minimal stub sketch, with the ESP32 core and GxEPD2/ArduinoJson libraries installed and version-pinned in README, ready for later tasks to add source files.

- [ ] **Step 1: Install arduino-cli and the ESP32 core**

```bash
brew install arduino-cli
arduino-cli version
arduino-cli config init
arduino-cli core update-index
arduino-cli core search esp32
```
Expected: `arduino-cli version` prints a version string; `core search esp32` lists `esp32:esp32` with an available version number. Note that version — it gets pinned in README (Step 6).

```bash
arduino-cli core install esp32:esp32
```
Expected: installs cleanly.

- [ ] **Step 2: Install and pin GxEPD2 (>= 1.6.0, per Global Constraints)**

```bash
arduino-cli lib search GxEPD2
```
Expected: lists a GxEPD2 version >= 1.6.0. If the latest available is below 1.6.0, stop and re-verify the version-floor requirement in the spec before proceeding — do not install an older version silently.

```bash
arduino-cli lib install GxEPD2
```
Expected: installs GxEPD2 and pulls in its dependencies (Adafruit GFX Library, Adafruit BusIO) automatically. Note the installed GxEPD2 version for README.

- [ ] **Step 3: Install and pin ArduinoJson (^7)**

```bash
arduino-cli lib search ArduinoJson
```
Expected: lists an ArduinoJson 7.x version (7.4.3 confirmed current as of this plan's writing — the network layer in Task 6 uses the v7 API, `JsonDocument` without a template size argument; do not install a 6.x release, its API differs).

```bash
arduino-cli lib install ArduinoJson
```
Expected: installs cleanly. Note the installed version for README.

- [ ] **Step 4: Write `firmware/.gitignore`**

```
secrets.h
build/
.arduino/
```

- [ ] **Step 5: Write `firmware/secrets.h.example`**

```cpp
#pragma once

#define WIFI_SSID "your-wifi-ssid"
#define WIFI_PASSWORD "your-wifi-password"
#define STANDINGS_URL "https://fantas-ink-server.vercel.app/api/standings"
#define SHARED_TOKEN "your-shared-token"

// POSIX TZ string for your location (handles DST automatically), e.g.
// "EST5EDT,M3.2.0,M11.1.0" for US Eastern. Find yours at:
// https://github.com/nayarsystems/posix_tz_db/blob/master/zones.csv
#define TZ_STRING "EST5EDT,M3.2.0,M11.1.0"
```

Then locally (not committed):
```bash
cp firmware/secrets.h.example firmware/secrets.h
# edit firmware/secrets.h with real values
```

- [ ] **Step 6: Write `firmware/root_ca.h`**

Verified byte-for-byte against two independent sources (`letsencrypt.org/certs/isrgrootx1.pem` and the Let's Encrypt website's own GitHub repo) during design review — do not hand-edit this certificate.

```cpp
#pragma once

// Let's Encrypt's ISRG Root X1, used to validate the TLS certificate
// presented by the Vercel-hosted standings endpoint. See design spec's
// Firmware section for why this must be pinned rather than using
// WiFiClientSecure::setInsecure().
static const char ISRG_ROOT_X1[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";
```

- [ ] **Step 7: Write a minimal `firmware/fantasy_hockey_scoreboard.ino` stub**

```cpp
void setup() {
  Serial.begin(115200);
}

void loop() {
}
```

- [ ] **Step 8: Compile to verify the toolchain works**

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware
```
Expected: `Sketch uses ... bytes` success output, no errors. (`esp32:esp32:esp32` is the generic "ESP32 Dev Module" board definition, the standard choice for this driver board's plain ESP32-WROOM module. If this FQBN doesn't exist in your installed core, run `arduino-cli board listall esp32` and use the closest generic ESP32 entry instead.)

- [ ] **Step 9: Write `firmware/README.md`**

```markdown
# Fantasy Hockey Scoreboard Firmware

## Toolchain

- `arduino-cli` (installed via `brew install arduino-cli`)
- Core: `esp32:esp32` — pin the version installed in Task 1, Step 1
- Libraries: `GxEPD2` (>= 1.6.0 — see design spec for why), `ArduinoJson` (^7) — pin the versions installed in Task 1, Steps 2-3

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

(Remaining sections — wiring/pinout reference and manual verification checklist — added in Task 7 once the full sketch exists.)
```

- [ ] **Step 10: Commit**

```bash
git add firmware/.gitignore firmware/secrets.h.example firmware/root_ca.h firmware/fantasy_hockey_scoreboard.ino firmware/README.md
git commit -m "chore: scaffold firmware project and pin toolchain versions"
```

---

### Task 2: Sleep timing (pure, host-tested)

**Files:**
- Create: `firmware/sleep_util.h`
- Create: `firmware/sleep_util.cpp`
- Create: `firmware/test/test_utils.h`
- Test: `firmware/test/sleep_util_test.cpp`

**Interfaces:**
- Consumes: nothing (standard C `<ctime>` only — no Arduino dependency).
- Produces: `uint64_t computeSleepMicros(time_t now, int wakeHour, int wakeMinute)` from `sleep_util.h`.

- [ ] **Step 1: Write the shared test-utility header**

```cpp
// firmware/test/test_utils.h
#pragma once
#include <iostream>
#include <string>

inline int g_failures = 0;

#define CHECK_EQ(actual, expected) do { \
  auto _a = (actual); auto _e = (expected); \
  if (!(_a == _e)) { \
    std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ \
               << " — expected " << _e << ", got " << _a << "\n"; \
    g_failures++; \
  } \
} while (0)

#define RUN(testFn) do { \
  std::cout << "  " #testFn "\n"; \
  testFn(); \
} while (0)
```

- [ ] **Step 2: Write the failing test**

```cpp
// firmware/test/sleep_util_test.cpp
#include "../sleep_util.h"
#include "test_utils.h"
#include <ctime>

static time_t makeLocalTime(int year, int month, int day, int hour, int min) {
  struct tm t = {};
  t.tm_year = year - 1900;
  t.tm_mon = month - 1;
  t.tm_mday = day;
  t.tm_hour = hour;
  t.tm_min = min;
  t.tm_sec = 0;
  t.tm_isdst = -1;
  return mktime(&t);
}

void test_sleeps_until_later_today() {
  time_t now = makeLocalTime(2026, 1, 15, 6, 0);
  uint64_t result = computeSleepMicros(now, 8, 0);
  CHECK_EQ(result, (uint64_t)2 * 60 * 60 * 1000000ULL);
}

void test_rolls_to_tomorrow_when_past_wake_time() {
  time_t now = makeLocalTime(2026, 1, 15, 9, 0);
  uint64_t result = computeSleepMicros(now, 8, 0);
  CHECK_EQ(result, (uint64_t)23 * 60 * 60 * 1000000ULL);
}

void test_exact_wake_time_rolls_to_tomorrow_not_zero() {
  time_t now = makeLocalTime(2026, 1, 15, 8, 0);
  uint64_t result = computeSleepMicros(now, 8, 0);
  // Never 0 — a `now` exactly at the wake time must roll to tomorrow, not
  // hand esp_sleep_enable_timer_wakeup() a zero-length sleep. This value
  // (86,400,000,000) also exceeds a 32-bit int's range, so a buggy
  // implementation using `int seconds * 1000000` would fail this check.
  CHECK_EQ(result, (uint64_t)24 * 60 * 60 * 1000000ULL);
}

void test_no_32_bit_overflow_across_month_boundary() {
  time_t now = makeLocalTime(2026, 1, 31, 8, 5);
  uint64_t result = computeSleepMicros(now, 8, 0);
  CHECK_EQ(result, (uint64_t)(23 * 3600 + 55 * 60) * 1000000ULL);
}

int main() {
  std::cout << "sleep_util_test\n";
  RUN(test_sleeps_until_later_today);
  RUN(test_rolls_to_tomorrow_when_past_wake_time);
  RUN(test_exact_wake_time_rolls_to_tomorrow_not_zero);
  RUN(test_no_32_bit_overflow_across_month_boundary);
  if (g_failures > 0) { std::cerr << g_failures << " failure(s)\n"; return 1; }
  std::cout << "OK\n";
  return 0;
}
```

- [ ] **Step 3: Write `sleep_util.h` (declaration only) and run to verify the test fails**

```cpp
// firmware/sleep_util.h
#pragma once
#include <cstdint>
#include <ctime>

// Returns microseconds to sleep from `now` until the next occurrence of
// wakeHour:wakeMinute local time. If `now` is already at or past today's
// wake time, returns the duration until tomorrow's — never 0.
uint64_t computeSleepMicros(time_t now, int wakeHour, int wakeMinute);
```

```bash
clang++ -std=c++17 firmware/test/sleep_util_test.cpp -o /tmp/sleep_util_test
```
Expected: FAIL to link — `computeSleepMicros` is declared but not defined.

- [ ] **Step 4: Write the implementation**

```cpp
// firmware/sleep_util.cpp
#include "sleep_util.h"

uint64_t computeSleepMicros(time_t now, int wakeHour, int wakeMinute) {
  struct tm target = *localtime(&now);
  target.tm_hour = wakeHour;
  target.tm_min = wakeMinute;
  target.tm_sec = 0;

  time_t targetTime = mktime(&target);
  if (targetTime <= now) {
    target.tm_mday += 1;
    targetTime = mktime(&target); // mktime normalizes month/year rollover
  }

  uint64_t secondsUntil = static_cast<uint64_t>(targetTime - now);
  return secondsUntil * 1000000ULL;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
clang++ -std=c++17 firmware/test/sleep_util_test.cpp firmware/sleep_util.cpp -o /tmp/sleep_util_test && /tmp/sleep_util_test
```
Expected: `OK` (4 tests, 0 failures).

- [ ] **Step 6: Commit**

```bash
git add firmware/sleep_util.h firmware/sleep_util.cpp firmware/test/test_utils.h firmware/test/sleep_util_test.cpp
git commit -m "feat: add pure sleep-duration calculation with host tests"
```

---

### Task 3: Display layout transform (pure, host-tested)

**Files:**
- Create: `firmware/display_layout.h`
- Create: `firmware/display_layout.cpp`
- Test: `firmware/test/display_layout_test.cpp`

**Interfaces:**
- Consumes: nothing (standard `<string>`/`<vector>` only — no Arduino dependency).
- Produces: `struct StandingsRow`, `struct LayoutRow`, `constexpr size_t MAX_NAME_CHARS`, `std::vector<LayoutRow> buildLayout(const std::vector<StandingsRow>& rows, size_t maxNameChars = MAX_NAME_CHARS)` from `display_layout.h`.

- [ ] **Step 1: Write the failing test**

```cpp
// firmware/test/display_layout_test.cpp
#include "../display_layout.h"
#include "test_utils.h"

void test_short_name_passes_through_unchanged() {
  std::vector<StandingsRow> rows = { {false, 1, "Team A", 10, 2, 0, false} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result.size(), (size_t)1);
  CHECK_EQ(result[0].displayName, std::string("Team A"));
  CHECK_EQ(result[0].rank, 1);
}

void test_long_name_is_truncated_to_max_chars() {
  std::vector<StandingsRow> rows = { {false, 1, "A Very Long Team Name Indeed", 10, 2, 0, false} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result[0].displayName.size(), (size_t)12);
  CHECK_EQ(result[0].displayName, std::string("A Very Long "));
}

void test_gap_row_passes_through_with_no_name_processing() {
  std::vector<StandingsRow> rows = { {true, 0, "", 0, 0, 0, false} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result.size(), (size_t)1);
  CHECK_EQ(result[0].isGap, true);
}

void test_isMe_flag_is_carried_through() {
  std::vector<StandingsRow> rows = { {false, 8, "My Team", 5, 7, 0, true} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result[0].isMe, true);
}

void test_empty_input_returns_empty_output() {
  std::vector<StandingsRow> rows;
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result.size(), (size_t)0);
}

int main() {
  std::cout << "display_layout_test\n";
  RUN(test_short_name_passes_through_unchanged);
  RUN(test_long_name_is_truncated_to_max_chars);
  RUN(test_gap_row_passes_through_with_no_name_processing);
  RUN(test_isMe_flag_is_carried_through);
  RUN(test_empty_input_returns_empty_output);
  if (g_failures > 0) { std::cerr << g_failures << " failure(s)\n"; return 1; }
  std::cout << "OK\n";
  return 0;
}
```

- [ ] **Step 2: Write `display_layout.h` (declaration only) and run to verify the test fails**

```cpp
// firmware/display_layout.h
#pragma once
#include <string>
#include <vector>
#include <cstddef>

// Mirrors one entry of the server's `rows[]` (see design spec's Data
// Contract) — already windowed/deduped/gap-marked server-side.
struct StandingsRow {
  bool isGap = false;
  int rank = 0;
  std::string name;
  int wins = 0;
  int losses = 0;
  int ties = 0;
  bool isMe = false;
};

struct LayoutRow {
  bool isGap = false;
  int rank = 0;
  std::string displayName;
  int wins = 0;
  int losses = 0;
  int ties = 0;
  bool isMe = false;
};

constexpr size_t MAX_NAME_CHARS = 12;

// Pure transform: truncates names to fit the display column width and
// passes gap/isMe markers through unchanged. Does not re-derive
// windowing/dedup/gap logic — that's already done server-side.
std::vector<LayoutRow> buildLayout(const std::vector<StandingsRow>& rows, size_t maxNameChars = MAX_NAME_CHARS);
```

```bash
clang++ -std=c++17 firmware/test/display_layout_test.cpp -o /tmp/display_layout_test
```
Expected: FAIL to link — `buildLayout` is declared but not defined.

- [ ] **Step 3: Write the implementation**

```cpp
// firmware/display_layout.cpp
#include "display_layout.h"

std::vector<LayoutRow> buildLayout(const std::vector<StandingsRow>& rows, size_t maxNameChars) {
  std::vector<LayoutRow> result;
  result.reserve(rows.size());
  for (const auto& row : rows) {
    LayoutRow out;
    out.isGap = row.isGap;
    if (row.isGap) {
      result.push_back(out);
      continue;
    }
    out.rank = row.rank;
    out.wins = row.wins;
    out.losses = row.losses;
    out.ties = row.ties;
    out.isMe = row.isMe;
    out.displayName = row.name.size() > maxNameChars
      ? row.name.substr(0, maxNameChars)
      : row.name;
    result.push_back(out);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
clang++ -std=c++17 firmware/test/display_layout_test.cpp firmware/display_layout.cpp -o /tmp/display_layout_test && /tmp/display_layout_test
```
Expected: `OK` (5 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add firmware/display_layout.h firmware/display_layout.cpp firmware/test/display_layout_test.cpp
git commit -m "feat: add pure display-layout transform with host tests"
```

---

### Task 4: Display rendering (hardware-dependent, compile-verified)

**Files:**
- Create: `firmware/display_render.h`
- Create: `firmware/display_render.cpp`

**Interfaces:**
- Consumes: `StandingsRow`, `LayoutRow` from Task 3's `display_layout.h`.
- Produces: `using Display = GxEPD2_BW<GxEPD2_420_GDEY042T81, GxEPD2_420_GDEY042T81::HEIGHT>`, `Display initDisplay()`, `void renderLayout(Display&, const std::vector<LayoutRow>&, const std::string& footer)`, `void renderMessage(Display&, const std::string&)`, `void hibernateDisplay(Display&)` from `display_render.h`.

- [ ] **Step 1: Write `display_render.h`**

```cpp
// firmware/display_render.h
#pragma once
#include <GxEPD2_BW.h>
#include <vector>
#include <string>
#include "display_layout.h"

using Display = GxEPD2_BW<GxEPD2_420_GDEY042T81, GxEPD2_420_GDEY042T81::HEIGHT>;

// Constructs the remapped HSPI bus this board requires (its CLK/DIN pins
// are swapped from the ESP32's default VSPI — see design spec's Hardware
// section) and returns an initialized display object.
Display initDisplay();

// Draws the standings table. `footer` is shown at the bottom (e.g.
// "Last updated: ..." for stale data) or left empty for fresh data.
void renderLayout(Display& display, const std::vector<LayoutRow>& rows, const std::string& footer);

// Full-screen single message — used for the first-boot/empty-cache case.
void renderMessage(Display& display, const std::string& message);

// Must be called after every render. See design spec: an unrefreshed,
// still-powered panel can be permanently damaged per Waveshare's own
// documentation — this is not optional cleanup.
void hibernateDisplay(Display& display);
```

- [ ] **Step 2: Write `display_render.cpp`**

```cpp
// firmware/display_render.cpp
#include "display_render.h"
#include <SPI.h>

// Pins confirmed against Waveshare's ESP32 e-Paper Driver Board wiki and
// GxEPD2's ConnectingHardware.md — see design spec's Hardware section.
static const int PIN_EPD_CS = 15;
static const int PIN_EPD_DC = 27;
static const int PIN_EPD_RST = 26;
static const int PIN_EPD_BUSY = 25;
static const int PIN_SPI_SCK = 13;
static const int PIN_SPI_MISO = 12; // unused by the panel (write-only), required by SPIClass::begin's signature
static const int PIN_SPI_MOSI = 14;

static SPIClass hspi(HSPI);

Display initDisplay() {
  hspi.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, PIN_EPD_CS);
  Display display(GxEPD2_420_GDEY042T81(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));
  display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  display.init(115200);
  display.setRotation(0);
  return display;
}

static const int ROW_HEIGHT = 26;
static const int TOP_MARGIN = 8;
static const int COL_RANK_X = 4;
static const int COL_NAME_X = 32;
static const int COL_RECORD_X = 300;

static void drawRow(Display& display, int y, const LayoutRow& row) {
  if (row.isMe) {
    display.drawRect(0, y - 2, display.width(), ROW_HEIGHT - 2, GxEPD_BLACK);
  }
  display.setCursor(COL_RANK_X, y + 16);
  display.print(row.rank);
  display.setCursor(COL_NAME_X, y + 16);
  display.print(row.displayName.c_str());
  display.setCursor(COL_RECORD_X, y + 16);
  display.print(row.wins);
  display.print('-');
  display.print(row.losses);
  display.print('-');
  display.print(row.ties);
}

static void drawGap(Display& display, int y) {
  for (int x = 4; x < display.width() - 4; x += 8) {
    display.drawFastHLine(x, y + ROW_HEIGHT / 2, 4, GxEPD_BLACK);
  }
}

void renderLayout(Display& display, const std::vector<LayoutRow>& rows, const std::string& footer) {
  display.setTextColor(GxEPD_BLACK);
  display.setTextSize(1);
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    int y = TOP_MARGIN;
    for (const auto& row : rows) {
      if (row.isGap) {
        drawGap(display, y);
      } else {
        drawRow(display, y, row);
      }
      y += ROW_HEIGHT;
    }
    if (!footer.empty()) {
      display.setCursor(4, display.height() - 8);
      display.print(footer.c_str());
    }
  } while (display.nextPage());
}

void renderMessage(Display& display, const std::string& message) {
  display.setTextColor(GxEPD_BLACK);
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(20, display.height() / 2);
    display.print(message.c_str());
  } while (display.nextPage());
}

void hibernateDisplay(Display& display) {
  display.hibernate();
}
```

- [ ] **Step 3: Compile to verify**

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware
```
Expected: success. (This is the test for this task — GxEPD2 drawing calls have no meaningful host-side stub and are verified visually later, on-device, per the Testing Approach in the design spec.)

- [ ] **Step 4: Commit**

```bash
git add firmware/display_render.h firmware/display_render.cpp
git commit -m "feat: add e-ink rendering (table layout, message screen, hibernate)"
```

---

### Task 5: NVS last-known-good cache (hardware-dependent, compile-verified)

**Files:**
- Create: `firmware/nvs_cache.h`
- Create: `firmware/nvs_cache.cpp`

**Interfaces:**
- Consumes: nothing new (Arduino `String` only).
- Produces: `bool cacheStandings(const String& rawJson)`, `bool hasCachedStandings()`, `String loadCachedStandings()` from `nvs_cache.h`.

- [ ] **Step 1: Write `nvs_cache.h`**

```cpp
// firmware/nvs_cache.h
#pragma once
#include <Arduino.h>

// Caches the raw standings JSON payload as last-known-good, so a fetch
// failure can still render something. NVS strings cap at 4000 bytes; the
// ~9-row payload is comfortably under that (see design spec's Failure
// Handling section) — no bounding logic needed here.
bool cacheStandings(const String& rawJson);
bool hasCachedStandings();
String loadCachedStandings();
```

- [ ] **Step 2: Write `nvs_cache.cpp`**

```cpp
// firmware/nvs_cache.cpp
#include "nvs_cache.h"
#include <Preferences.h>

static const char* NVS_NAMESPACE = "standings";
static const char* NVS_KEY = "latest";

bool cacheStandings(const String& rawJson) {
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, false)) return false;
  size_t written = prefs.putString(NVS_KEY, rawJson);
  prefs.end();
  return written == rawJson.length();
}

bool hasCachedStandings() {
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, true)) return false;
  bool exists = prefs.isKey(NVS_KEY);
  prefs.end();
  return exists;
}

String loadCachedStandings() {
  Preferences prefs;
  if (!prefs.begin(NVS_NAMESPACE, true)) return "";
  String value = prefs.getString(NVS_KEY, "");
  prefs.end();
  return value;
}
```

- [ ] **Step 3: Compile to verify**

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware
```
Expected: success. (`Preferences.h` ships with the ESP32 Arduino core — no extra library install needed. Same as Task 4, this has no meaningful host-side test; verified on-device in Task 7's manual checklist.)

- [ ] **Step 4: Commit**

```bash
git add firmware/nvs_cache.h firmware/nvs_cache.cpp
git commit -m "feat: add NVS-backed last-known-good standings cache"
```

---

### Task 6: Network layer (hardware-dependent, compile-verified)

**Files:**
- Create: `firmware/network_api.h`
- Create: `firmware/network_api.cpp`

**Interfaces:**
- Consumes: `StandingsRow` from Task 3's `display_layout.h`; `ISRG_ROOT_X1` from Task 1's `root_ca.h`.
- Produces: `bool connectWiFi(const char* ssid, const char* password, uint32_t timeoutMs)`, `void syncTime(const char* tzString)`, `struct FetchResult { bool success; std::vector<StandingsRow> rows; String rawJson; String asOf; }`, `FetchResult parseStandingsJson(const String& payload)`, `FetchResult fetchStandings(const char* url, const char* sharedToken, int maxRetries, uint32_t backoffBaseMs)` from `network_api.h`.

- [ ] **Step 1: Write `network_api.h`**

```cpp
// firmware/network_api.h
#pragma once
#include <Arduino.h>
#include <vector>
#include "display_layout.h"

// Blocks up to `timeoutMs` attempting to associate to WiFi. Returns false
// on timeout rather than blocking indefinitely — callers must still
// deep-sleep on a false return (see design spec's wake-cycle time budget).
bool connectWiFi(const char* ssid, const char* password, uint32_t timeoutMs);

// Sets system time from NTP under the given POSIX TZ string. Must be
// called before fetchStandings() — TLS certificate validity checks need a
// correct clock.
void syncTime(const char* tzString);

struct FetchResult {
  bool success = false;
  std::vector<StandingsRow> rows;
  String rawJson;
  String asOf;
};

// Parses a standings JSON payload (as returned by /api/standings, or a
// cached copy of one) into StandingsRow entries. Exposed separately from
// fetchStandings so the cached-fallback path can reuse it without an
// HTTP round-trip.
FetchResult parseStandingsJson(const String& payload);

// GETs `url` with `sharedToken` as the `?token=` query param, over HTTPS
// pinned to the ISRG Root X1 CA (root_ca.h). Retries up to `maxRetries`
// times with linear backoff (`backoffBaseMs * attempt`) between attempts.
FetchResult fetchStandings(const char* url, const char* sharedToken, int maxRetries, uint32_t backoffBaseMs);
```

- [ ] **Step 2: Write `network_api.cpp`**

```cpp
// firmware/network_api.cpp
#include "network_api.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#define ARDUINOJSON_ENABLE_STD_STRING 1
#include <ArduinoJson.h>
#include "root_ca.h"

bool connectWiFi(const char* ssid, const char* password, uint32_t timeoutMs) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > timeoutMs) return false;
    delay(200);
  }
  return true;
}

void syncTime(const char* tzString) {
  configTzTime(tzString, "pool.ntp.org", "time.nist.gov");
  time_t now = 0;
  uint32_t start = millis();
  // Wait for a plausible post-2023 timestamp, capped at 15s so a slow/dead
  // NTP server can't blow the overall wake-cycle time budget.
  while (now < 1700000000 && millis() - start < 15000) {
    delay(200);
    time(&now);
  }
}

FetchResult parseStandingsJson(const String& payload) {
  FetchResult result;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) return result;

  for (JsonObject rowObj : doc["rows"].as<JsonArray>()) {
    StandingsRow row;
    if (rowObj["gap"].is<bool>() && rowObj["gap"].as<bool>()) {
      row.isGap = true;
    } else {
      row.rank = rowObj["rank"].as<int>();
      row.name = rowObj["name"].as<std::string>();
      row.wins = rowObj["wins"].as<int>();
      row.losses = rowObj["losses"].as<int>();
      row.ties = rowObj["ties"].as<int>();
      row.isMe = rowObj["isMe"].is<bool>() && rowObj["isMe"].as<bool>();
    }
    result.rows.push_back(row);
  }
  result.asOf = doc["asOf"].as<String>();
  result.rawJson = payload;
  result.success = true;
  return result;
}

FetchResult fetchStandings(const char* url, const char* sharedToken, int maxRetries, uint32_t backoffBaseMs) {
  for (int attempt = 1; attempt <= maxRetries; attempt++) {
    WiFiClientSecure client;
    client.setCACert(ISRG_ROOT_X1);

    HTTPClient http;
    String fullUrl = String(url) + "?token=" + sharedToken;
    if (http.begin(client, fullUrl)) {
      int status = http.GET();
      if (status == 200) {
        String payload = http.getString();
        http.end();
        FetchResult result = parseStandingsJson(payload);
        if (result.success) return result;
      } else {
        http.end();
      }
    }
    if (attempt < maxRetries) delay(backoffBaseMs * attempt);
  }
  return FetchResult{};
}
```

- [ ] **Step 3: Compile to verify**

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware
```
Expected: success. (WiFi/HTTPClient/WiFiClientSecure ship with the ESP32 Arduino core; ArduinoJson was installed in Task 1. As with Tasks 4-5, this is compile-verified only — network behavior is verified on-device in Task 7's manual checklist, including forced-failure cases.)

- [ ] **Step 4: Commit**

```bash
git add firmware/network_api.h firmware/network_api.cpp
git commit -m "feat: add WiFi/NTP/HTTPS network layer with retry and pinned TLS"
```

---

### Task 7: Orchestration, final wiring, and README

**Files:**
- Modify: `firmware/fantasy_hockey_scoreboard.ino` (replaces Task 1's stub)
- Modify: `firmware/README.md` (adds wiring reference and manual verification checklist)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a complete, flashable sketch — the deliverable of this whole plan.

- [ ] **Step 1: Write the full orchestration sketch**

```cpp
// firmware/fantasy_hockey_scoreboard.ino
#include "secrets.h"
#include "sleep_util.h"
#include "display_layout.h"
#include "display_render.h"
#include "network_api.h"
#include "nvs_cache.h"

static const int WAKE_HOUR = 8;
static const int WAKE_MINUTE = 0;
static const uint32_t WIFI_TIMEOUT_MS = 30000;
static const uint32_t WAKE_CYCLE_BUDGET_MS = 60000;
static const int FETCH_MAX_RETRIES = 3;
static const uint32_t FETCH_BACKOFF_BASE_MS = 2000;

static void goToSleep() {
  time_t now;
  time(&now);
  uint64_t sleepMicros = computeSleepMicros(now, WAKE_HOUR, WAKE_MINUTE);
  esp_sleep_enable_timer_wakeup(sleepMicros);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  uint32_t cycleStart = millis();

  Display display = initDisplay();

  bool haveFreshData = false;
  FetchResult data;

  if (connectWiFi(WIFI_SSID, WIFI_PASSWORD, WIFI_TIMEOUT_MS)) {
    syncTime(TZ_STRING);

    uint32_t elapsed = millis() - cycleStart;
    uint32_t remainingBudget = elapsed > WAKE_CYCLE_BUDGET_MS ? 0 : WAKE_CYCLE_BUDGET_MS - elapsed;
    if (remainingBudget > 0) {
      data = fetchStandings(STANDINGS_URL, SHARED_TOKEN, FETCH_MAX_RETRIES, FETCH_BACKOFF_BASE_MS);
      if (data.success) {
        cacheStandings(data.rawJson);
        haveFreshData = true;
      }
    }
  } else {
    Serial.println("WiFi connect failed");
  }

  if (haveFreshData) {
    auto layout = buildLayout(data.rows);
    renderLayout(display, layout, "");
  } else if (hasCachedStandings()) {
    FetchResult cached = parseStandingsJson(loadCachedStandings());
    auto layout = buildLayout(cached.rows);
    std::string footer = "Last updated: " + std::string(cached.asOf.c_str());
    renderLayout(display, layout, footer);
  } else {
    renderMessage(display, "No data yet");
  }

  hibernateDisplay(display);
  goToSleep();
}

void loop() {
  // Never reached — setup() always ends in deep sleep.
}
```

- [ ] **Step 2: Compile the complete sketch**

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware
```
Expected: success, no unresolved symbols.

- [ ] **Step 3: Append wiring reference and manual verification checklist to `firmware/README.md`**

```markdown

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
```

- [ ] **Step 4: Commit**

```bash
git add firmware/fantasy_hockey_scoreboard.ino firmware/README.md
git commit -m "feat: wire up firmware orchestration and finalize README"
```
