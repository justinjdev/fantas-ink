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
