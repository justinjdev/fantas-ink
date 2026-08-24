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
static const gpio_num_t BUTTON_PIN = GPIO_NUM_4; // provisional - confirm against real hardware
RTC_DATA_ATTR int currentPage = 0; // 0 = standings/matchup, 1 = category breakdown

static void armWakeSources(uint64_t sleepMicros) {
  esp_sleep_enable_timer_wakeup(sleepMicros);
  esp_sleep_enable_ext0_wakeup(BUTTON_PIN, 1); // wake on HIGH (button pulls the pin high when pressed)
}

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
  pinMode(BUTTON_PIN, INPUT_PULLDOWN);
  armWakeSources(sleepMicros);
  esp_deep_sleep_start();
}

static void handleButtonWake() {
  currentPage = currentPage == 0 ? 1 : 0;
  Serial.printf("Button wake: switching to page %d\n", currentPage);

  Display& display = initDisplay();

  FetchResult cached;
  if (hasCachedStandings()) {
    cached = parseStandingsJson(loadCachedStandings());
  }
  if (cached.success && !cached.rows.empty()) {
    auto layout = buildLayout(cached.rows);
    std::string footer = "Last updated: " + std::string(cached.asOf.c_str());
    if (currentPage == 0) {
      renderStandingsPage(display, cached.leagueName.c_str(), layout, cached.hasPlayoffTeams,
                          cached.playoffTeams, cached.currentMatchup, cached.lastMatchup,
                          cached.nextMatchup, footer);
    } else {
      std::string myTeamName;
      for (const auto& row : cached.rows) {
        if (!row.isGap && row.isMe) { myTeamName = row.name; break; }
      }
      renderCategoryPage(display, myTeamName, cached.currentMatchup, footer);
    }
  } else {
    renderMessage(display, "No data yet");
  }
  hibernateDisplay(display);

  // EXT0 wake is level-triggered, not edge-triggered - a held or bouncing
  // button would otherwise re-trigger the moment we go back to sleep. Wait
  // for the pin to return to idle (LOW) before re-arming, capped so a
  // stuck/held button can't hang the device awake indefinitely.
  uint32_t debounceStart = millis();
  while (digitalRead(BUTTON_PIN) == HIGH && millis() - debounceStart < 2000) {
    delay(20);
  }

  time_t now;
  time(&now);
  uint64_t sleepMicros = now < PLAUSIBLE_TIME_THRESHOLD
    ? FALLBACK_RETRY_SLEEP_MICROS
    : computeSleepMicros(now, WAKE_HOUR, WAKE_MINUTE);
  armWakeSources(sleepMicros);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);

  esp_sleep_wakeup_cause_t wakeCause = esp_sleep_get_wakeup_cause();
  if (wakeCause == ESP_SLEEP_WAKEUP_EXT0) {
    pinMode(BUTTON_PIN, INPUT_PULLDOWN);
    handleButtonWake();
    return;
  }
  currentPage = 0; // any non-button wake (daily timer, or first boot) resets to page 1

  uint32_t cycleStart = millis();

  // Bound by reference — Display embeds a ~15KB framebuffer that will not fit
  // on loopTask's 8192-byte stack. See display_render.h.
  Display& display = initDisplay();
  renderMessage(display, "Booting...");

  bool haveFreshData = false;
  FetchResult data;

  renderMessage(display, "Connecting WiFi...");
  if (connectWiFi(WIFI_SSID, WIFI_PASSWORD, WIFI_TIMEOUT_MS)) {
    Serial.println("WiFi connected");
    renderMessage(display, "Syncing time...");
    syncTime(TZ_STRING);

    uint32_t elapsed = millis() - cycleStart;
    uint32_t remainingBudget = elapsed > WAKE_CYCLE_BUDGET_MS ? 0 : WAKE_CYCLE_BUDGET_MS - elapsed;
    Serial.printf("Budget: %lu ms remaining for fetch\n", (unsigned long)remainingBudget);
    if (remainingBudget > 0) {
      renderMessage(display, "Fetching standings...");
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
    renderMessage(display, "WiFi connect failed");
  }

  if (haveFreshData) {
    Serial.printf("Data source: fresh fetch (%u rows)\n", (unsigned)data.rows.size());
    auto layout = buildLayout(data.rows);
    renderStandingsPage(display, data.leagueName.c_str(), layout, data.hasPlayoffTeams, data.playoffTeams,
                        data.currentMatchup, data.lastMatchup, data.nextMatchup, "");
  } else {
    FetchResult cached;
    if (hasCachedStandings()) {
      cached = parseStandingsJson(loadCachedStandings());
    }
    if (cached.success && !cached.rows.empty()) {
      Serial.printf("Data source: NVS cache (%u rows)\n", (unsigned)cached.rows.size());
      auto layout = buildLayout(cached.rows);
      std::string footer = "Last updated: " + std::string(cached.asOf.c_str());
      renderStandingsPage(display, cached.leagueName.c_str(), layout, cached.hasPlayoffTeams, cached.playoffTeams,
                          cached.currentMatchup, cached.lastMatchup, cached.nextMatchup, footer);
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
