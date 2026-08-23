#include "../sleep_util.h"
#include "test_utils.h"
#include <ctime>

static time_t makeLocalTime(int year, int month, int day, int hour, int min) {
  struct tm t = {};
  t.tm_year = year - 1900;
  t.tm_mon = month - 1;
  t.tm_mday = day;
  t.tm_hour = hour;
  t.tm_min = min;
  t.tm_sec = 0;
  t.tm_isdst = -1;
  return mktime(&t);
}

void test_sleeps_until_later_today() {
  time_t now = makeLocalTime(2026, 1, 15, 6, 0);
  uint64_t result = computeSleepMicros(now, 8, 0);
  CHECK_EQ(result, (uint64_t)2 * 60 * 60 * 1000000ULL);
}

void test_rolls_to_tomorrow_when_past_wake_time() {
  time_t now = makeLocalTime(2026, 1, 15, 9, 0);
  uint64_t result = computeSleepMicros(now, 8, 0);
  CHECK_EQ(result, (uint64_t)23 * 60 * 60 * 1000000ULL);
}

void test_exact_wake_time_rolls_to_tomorrow_not_zero() {
  time_t now = makeLocalTime(2026, 1, 15, 8, 0);
  uint64_t result = computeSleepMicros(now, 8, 0);
  // Never 0 — a `now` exactly at the wake time must roll to tomorrow, not
  // hand esp_sleep_enable_timer_wakeup() a zero-length sleep. This value
  // (86,400,000,000) also exceeds a 32-bit int's range, so a buggy
  // implementation using `int seconds * 1000000` would fail this check.
  CHECK_EQ(result, (uint64_t)24 * 60 * 60 * 1000000ULL);
}

void test_no_32_bit_overflow_across_month_boundary() {
  time_t now = makeLocalTime(2026, 1, 31, 8, 5);
  uint64_t result = computeSleepMicros(now, 8, 0);
  CHECK_EQ(result, (uint64_t)(23 * 3600 + 55 * 60) * 1000000ULL);
}

int main() {
  std::cout << "sleep_util_test\n";
  RUN(test_sleeps_until_later_today);
  RUN(test_rolls_to_tomorrow_when_past_wake_time);
  RUN(test_exact_wake_time_rolls_to_tomorrow_not_zero);
  RUN(test_no_32_bit_overflow_across_month_boundary);
  if (g_failures > 0) { std::cerr << g_failures << " failure(s)\n"; return 1; }
  std::cout << "OK\n";
  return 0;
}
