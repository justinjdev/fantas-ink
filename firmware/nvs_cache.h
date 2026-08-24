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
