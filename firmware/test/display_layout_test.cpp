// firmware/test/display_layout_test.cpp
#include "../display_layout.h"
#include "test_utils.h"

void test_short_name_passes_through_unchanged() {
  std::vector<StandingsRow> rows = { {false, 1, "Team A", 10, 2, 0, false} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result.size(), (size_t)1);
  CHECK_EQ(result[0].displayName, std::string("Team A"));
  CHECK_EQ(result[0].rank, 1);
}

void test_long_name_is_truncated_to_max_chars() {
  std::vector<StandingsRow> rows = { {false, 1, "A Very Long Team Name Indeed", 10, 2, 0, false} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result[0].displayName.size(), (size_t)12);
  CHECK_EQ(result[0].displayName, std::string("A Very Long "));
}

void test_gap_row_passes_through_with_no_name_processing() {
  std::vector<StandingsRow> rows = { {true, 0, "", 0, 0, 0, false} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result.size(), (size_t)1);
  CHECK_EQ(result[0].isGap, true);
}

void test_isMe_flag_is_carried_through() {
  std::vector<StandingsRow> rows = { {false, 8, "My Team", 5, 7, 0, true} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result[0].isMe, true);
}

void test_empty_input_returns_empty_output() {
  std::vector<StandingsRow> rows;
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result.size(), (size_t)0);
}

int main() {
  std::cout << "display_layout_test\n";
  RUN(test_short_name_passes_through_unchanged);
  RUN(test_long_name_is_truncated_to_max_chars);
  RUN(test_gap_row_passes_through_with_no_name_processing);
  RUN(test_isMe_flag_is_carried_through);
  RUN(test_empty_input_returns_empty_output);
  if (g_failures > 0) { std::cerr << g_failures << " failure(s)\n"; return 1; }
  std::cout << "OK\n";
  return 0;
}
