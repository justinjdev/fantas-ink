#pragma once
#include <cstdint>
#include <ctime>

// Returns microseconds to sleep from `now` until the next occurrence of
// wakeHour:wakeMinute local time. If `now` is already at or past today's
// wake time, returns the duration until tomorrow's — never 0.
uint64_t computeSleepMicros(time_t now, int wakeHour, int wakeMinute);
