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
