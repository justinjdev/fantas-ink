// firmware/network_api.cpp
#include "network_api.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#define ARDUINOJSON_ENABLE_STD_STRING 1
#include <ArduinoJson.h>
#include "root_ca.h"

const time_t PLAUSIBLE_TIME_THRESHOLD = 1700000000;

// WiFiClientSecure::setCACert() stores the pointer it is given without
// copying, and mbedtls wants both PEM roots in one contiguous buffer, so the
// concatenation lives in static storage and is built once. The PROGMEM reads
// go through memcpy_P rather than String concatenation, which would ignore
// the PROGMEM attribute on cores where it is not a no-op.
static const char* rootCaBundle() {
  static char bundle[sizeof(ISRG_ROOT_X1) + sizeof(GTS_ROOT_R1) - 1];
  static bool built = false;
  if (!built) {
    memcpy_P(bundle, ISRG_ROOT_X1, sizeof(ISRG_ROOT_X1) - 1);
    memcpy_P(bundle + sizeof(ISRG_ROOT_X1) - 1, GTS_ROOT_R1, sizeof(GTS_ROOT_R1));
    built = true;
  }
  return bundle;
}

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
  while (now < PLAUSIBLE_TIME_THRESHOLD && millis() - start < 15000) {
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
  if (result.rows.empty()) return FetchResult{};

  result.asOf = doc["asOf"].as<String>();
  if (result.asOf.length() == 0) return FetchResult{};

  result.rawJson = payload;
  result.success = true;
  return result;
}

// Worst case a single started attempt can take: connect timeout + handshake
// timeout (the request/response itself is a few KB of JSON, negligible next
// to these). An attempt is only started if it could still finish by
// deadlineMs even at this worst case — otherwise the loop would check the
// deadline between attempts but let an in-flight one overrun it.
static const uint32_t MAX_ATTEMPT_DURATION_MS = 5000 + 10000;

FetchResult fetchStandings(const char* url, const char* sharedToken, int maxRetries, uint32_t backoffBaseMs,
                           uint32_t deadlineMs) {
  for (int attempt = 1; attempt <= maxRetries; attempt++) {
    // Checked before every attempt, the first included: without this the
    // core's default 120s handshake timeout times maxRetries can hold the
    // device awake for minutes past the wake-cycle budget.
    if ((int32_t)(millis() + MAX_ATTEMPT_DURATION_MS - deadlineMs) >= 0) {
      Serial.println("Fetch: time budget exhausted, giving up");
      break;
    }

    WiFiClientSecure client;
    client.setCACert(rootCaBundle());
    client.setHandshakeTimeout(10);  // seconds

    HTTPClient http;
    http.setConnectTimeout(5000);  // milliseconds
    http.setTimeout(5000);
    String fullUrl = String(url) + "?token=" + sharedToken;
    if (http.begin(client, fullUrl)) {
      int status = http.GET();
      if (status == 200) {
        String payload = http.getString();
        http.end();
        FetchResult result = parseStandingsJson(payload);
        if (result.success) return result;
        Serial.println("Fetch: HTTP 200 but payload did not parse");
      } else {
        http.end();
        Serial.printf("Fetch: attempt %d failed with status %d\n", attempt, status);
        // A rejected token is not a transient failure — retrying only burns
        // the remaining time budget.
        if (status == 401) return FetchResult{};
      }
    } else {
      Serial.printf("Fetch: attempt %d could not build request\n", attempt);
    }
    if (attempt < maxRetries) delay(backoffBaseMs * attempt);
  }
  return FetchResult{};
}
