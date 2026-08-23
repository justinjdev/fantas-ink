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

static void goToSleep() {
  time_t now;
  time(&now);
  uint64_t sleepMicros;
  if (now < PLAUSIBLE_TIME_THRESHOLD) {
    // Clock was never synced this boot (WiFi/NTP failure, or first boot with no
    // battery-backed RTC), so computeSleepMicros() would target 8am relative to
    // a near-epoch timestamp. Retry sooner instead.
    sleepMicros = FALLBACK_RETRY_SLEEP_MICROS;
    Serial.println("Sleep: clock never synced, using 1h retry fallback");
  } else {
    sleepMicros = computeSleepMicros(now, WAKE_HOUR, WAKE_MINUTE);
    Serial.println("Sleep: clock synced, scheduling next 8am wake");
  }
  Serial.printf("Sleep: sleepMicros=%llu (%.2f hours)\n", sleepMicros, sleepMicros / 3600000000.0);
  Serial.flush();
  esp_sleep_enable_timer_wakeup(sleepMicros);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  uint32_t cycleStart = millis();

  // Bound by reference — Display embeds a ~15KB framebuffer that will not fit
  // on loopTask's 8192-byte stack. See display_render.h.
  Display& display = initDisplay();

  bool haveFreshData = false;
  FetchResult data;

  if (connectWiFi(WIFI_SSID, WIFI_PASSWORD, WIFI_TIMEOUT_MS)) {
    Serial.println("WiFi connected");
    syncTime(TZ_STRING);

    uint32_t elapsed = millis() - cycleStart;
    uint32_t remainingBudget = elapsed > WAKE_CYCLE_BUDGET_MS ? 0 : WAKE_CYCLE_BUDGET_MS - elapsed;
    Serial.printf("Budget: %lu ms remaining for fetch\n", (unsigned long)remainingBudget);
    if (remainingBudget > 0) {
      data = fetchStandings(STANDINGS_URL, SHARED_TOKEN, FETCH_MAX_RETRIES, FETCH_BACKOFF_BASE_MS,
                            millis() + remainingBudget);
      if (data.success) {
        if (!cacheStandings(data.rawJson)) {
          Serial.println("WARNING: NVS cache write failed");
        }
        haveFreshData = true;
      }
    }
  } else {
    Serial.println("WiFi connect failed");
  }

  if (haveFreshData) {
    Serial.printf("Data source: fresh fetch (%u rows)\n", (unsigned)data.rows.size());
    auto layout = buildLayout(data.rows);
    renderLayout(display, layout, "");
  } else {
    FetchResult cached;
    if (hasCachedStandings()) {
      cached = parseStandingsJson(loadCachedStandings());
    }
    if (cached.success && !cached.rows.empty()) {
      Serial.printf("Data source: NVS cache (%u rows)\n", (unsigned)cached.rows.size());
      auto layout = buildLayout(cached.rows);
      std::string footer = "Last updated: " + std::string(cached.asOf.c_str());
      renderLayout(display, layout, footer);
    } else {
      // Covers both "never fetched anything" and "cache present but empty or
      // corrupt" — rendering the latter would leave a blank page with a bare
      // "Last updated: " footer.
      Serial.println("Data source: none, rendering 'No data yet'");
      renderMessage(display, "No data yet");
    }
  }

  Serial.println("Display: hibernating panel");
  hibernateDisplay(display);
  goToSleep();
}

void loop() {
  // Never reached — setup() always ends in deep sleep.
}
