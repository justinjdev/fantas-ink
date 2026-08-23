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
