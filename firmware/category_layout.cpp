// firmware/category_layout.cpp
//
// A hardcoded category-table row height once overran the page footer during
// design iteration, because the real category count (league-configured, not
// fixed) didn't match the constant the layout was tuned against. This file
// exists so that class of bug is a pure-function test, not a rendering bug
// only visible on real hardware.
#include "category_layout.h"

bool categoryLeaderIsMe(const CategoryStat& stat) {
  return stat.higherWins ? stat.mine > stat.theirs : stat.mine < stat.theirs;
}

bool categoryLeaderIsThem(const CategoryStat& stat) {
  return stat.higherWins ? stat.theirs > stat.mine : stat.theirs < stat.mine;
}

float categoryRowHeight(size_t categoryCount, float tableTop, float tableBottom) {
  if (categoryCount == 0) return 0.0f;
  return (tableBottom - tableTop) / static_cast<float>(categoryCount);
}
