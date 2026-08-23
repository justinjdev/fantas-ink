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
