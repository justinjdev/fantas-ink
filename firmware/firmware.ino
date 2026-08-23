// firmware/firmware.ino
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
static const uint64_t FALLBACK_RETRY_SLEEP_MICROS = 60ULL * 60 * 1000000ULL;
static const time_t PLAUSIBLE_TIME_THRESHOLD = 1700000000;  // matches network_api.cpp's NTP sync-wait heuristic

static void goToSleep() {
  time_t now;
  time(&now);
  uint64_t sleepMicros;
  if (now < PLAUSIBLE_TIME_THRESHOLD) {
    // Clock was never synced this boot (WiFi/NTP failure, or first boot with no
    // battery-backed RTC), so computeSleepMicros() would target 8am relative to
    // a near-epoch timestamp. Retry sooner instead.
    sleepMicros = FALLBACK_RETRY_SLEEP_MICROS;
  } else {
    sleepMicros = computeSleepMicros(now, WAKE_HOUR, WAKE_MINUTE);
  }
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
