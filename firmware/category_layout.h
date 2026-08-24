#pragma once
#include <cstddef>
#include <string>

struct CategoryStat {
  std::string label;
  double mine = 0;
  double theirs = 0;
  bool higherWins = true;
};

bool categoryLeaderIsMe(const CategoryStat& stat);
bool categoryLeaderIsThem(const CategoryStat& stat);

// Row height for a `categoryCount`-row table evenly filling [tableTop, tableBottom].
// Must be computed, not a constant — see the file-level comment in
// category_layout.cpp for why this specific function exists.
float categoryRowHeight(size_t categoryCount, float tableTop, float tableBottom);
