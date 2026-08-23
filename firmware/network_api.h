// firmware/network_api.h
#pragma once
#include <Arduino.h>
#include <vector>
#include "display_layout.h"

// Blocks up to `timeoutMs` attempting to associate to WiFi. Returns false
// on timeout rather than blocking indefinitely — callers must still
// deep-sleep on a false return (see design spec's wake-cycle time budget).
bool connectWiFi(const char* ssid, const char* password, uint32_t timeoutMs);

// Lower bound for a "the clock has really been synced" check: any Unix
// timestamp below this (2023-11-14) means NTP never landed this boot.
// Shared so the NTP sync-wait and the sleep-scheduling fallback can't drift
// apart. Defined in network_api.cpp.
extern const time_t PLAUSIBLE_TIME_THRESHOLD;

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
// HTTP round-trip. A payload that parses as JSON but yields no rows is
// treated as a failure (success == false) — a real standings response
// always carries rows, so an empty one is an error body, not data worth
// caching or rendering.
FetchResult parseStandingsJson(const String& payload);

// GETs `url` with `sharedToken` as the `?token=` query param, over HTTPS
// pinned to the roots bundled in root_ca.h. Retries up to `maxRetries`
// times with linear backoff (`backoffBaseMs * attempt`) between attempts,
// except on HTTP 401, which returns immediately (a wrong token will never
// succeed on retry).
//
// `deadlineMs` is a wall-clock deadline on the `millis()` timebase (i.e.
// callers pass `millis() + remainingBudget`). No attempt is started once
// `millis()` has reached it, including the first — this is what keeps the
// retry loop inside the wake-cycle time budget.
FetchResult fetchStandings(const char* url, const char* sharedToken, int maxRetries, uint32_t backoffBaseMs,
                           uint32_t deadlineMs);
