// firmware/test/category_layout_test.cpp
#include "../category_layout.h"
#include "test_utils.h"

void test_higher_wins_category_leader_is_whoever_has_the_bigger_number() {
  CategoryStat goals{"G", 14, 10, true};
  CHECK_EQ(categoryLeaderIsMe(goals), true);
  CHECK_EQ(categoryLeaderIsThem(goals), false);
}

void test_lower_wins_category_leader_is_whoever_has_the_smaller_number() {
  CategoryStat gaa{"GAA", 2.85, 2.60, false};
  CHECK_EQ(categoryLeaderIsMe(gaa), false);
  CHECK_EQ(categoryLeaderIsThem(gaa), true);
}

void test_tied_category_has_no_leader_on_either_side() {
  CategoryStat blocks{"BLK", 33, 33, true};
  CHECK_EQ(categoryLeaderIsMe(blocks), false);
  CHECK_EQ(categoryLeaderIsThem(blocks), false);
}

void test_row_height_evenly_divides_the_available_space() {
  float height = categoryRowHeight(13, 118.0f, 440.0f);
  CHECK_EQ(height > 24.7f && height < 24.8f, true);
}

void test_row_height_adapts_to_a_different_category_count_without_overrunning() {
  float heightFor13 = categoryRowHeight(13, 118.0f, 440.0f);
  float heightFor8 = categoryRowHeight(8, 118.0f, 440.0f);
  // Fewer categories must mean MORE room per row, not the same hardcoded value —
  // this is the exact property that broke once when the height was a constant.
  CHECK_EQ(heightFor8 > heightFor13, true);
  CHECK_EQ(118.0f + heightFor8 * 8 <= 440.0f, true);
  CHECK_EQ(118.0f + heightFor13 * 13 <= 440.0f, true);
}

void test_row_height_is_zero_for_zero_categories_not_a_divide_by_zero_crash() {
  CHECK_EQ(categoryRowHeight(0, 118.0f, 440.0f), 0.0f);
}

int main() {
  std::cout << "category_layout_test\n";
  RUN(test_higher_wins_category_leader_is_whoever_has_the_bigger_number);
  RUN(test_lower_wins_category_leader_is_whoever_has_the_smaller_number);
  RUN(test_tied_category_has_no_leader_on_either_side);
  RUN(test_row_height_evenly_divides_the_available_space);
  RUN(test_row_height_adapts_to_a_different_category_count_without_overrunning);
  RUN(test_row_height_is_zero_for_zero_categories_not_a_divide_by_zero_crash);
  if (g_failures > 0) { std::cerr << g_failures << " failure(s)\n"; return 1; }
  std::cout << "OK\n";
  return 0;
}
