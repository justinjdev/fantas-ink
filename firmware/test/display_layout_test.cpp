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

void test_name_exactly_at_max_chars_is_not_truncated() {
  std::vector<StandingsRow> rows = { {false, 1, "Twelve Chars", 10, 2, 0, false} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result[0].displayName.size(), (size_t)12);
  CHECK_EQ(result[0].displayName, std::string("Twelve Chars"));
}

void test_mixed_gap_and_data_rows_in_one_call() {
  std::vector<StandingsRow> rows = {
    {false, 1, "Team A", 10, 2, 0, false},
    {true, 0, "", 0, 0, 0, false},
    {false, 8, "My Team", 5, 7, 0, true},
  };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result.size(), (size_t)3);
  CHECK_EQ(result[0].isGap, false);
  CHECK_EQ(result[0].displayName, std::string("Team A"));
  CHECK_EQ(result[1].isGap, true);
  CHECK_EQ(result[2].isGap, false);
  CHECK_EQ(result[2].isMe, true);
  CHECK_EQ(result[2].rank, 8);
}

void test_winPct_and_streak_pass_through_unchanged() {
  std::vector<StandingsRow> rows = { {false, 1, "Team A", 10, 2, 0, false, ".833", "W4"} };
  auto result = buildLayout(rows, 12);
  CHECK_EQ(result[0].winPct, std::string(".833"));
  CHECK_EQ(result[0].streak, std::string("W4"));
}

void test_matchup_structs_default_to_not_present() {
  MatchupSummary last;
  CurrentMatchup current;
  NextMatchup next;
  CHECK_EQ(last.present, false);
  CHECK_EQ(current.present, false);
  CHECK_EQ(next.present, false);
}

void test_current_matchup_carries_a_category_list() {
  CurrentMatchup current;
  current.present = true;
  current.opponent = "Ice Capades";
  current.status = "AHEAD";
  current.tally = "7-5-1";
  current.categories.push_back(CategoryStat{"G", 14, 10, true});
  CHECK_EQ(current.categories.size(), (size_t)1);
  CHECK_EQ(current.categories[0].label, std::string("G"));
}

int main() {
  std::cout << "display_layout_test\n";
  RUN(test_short_name_passes_through_unchanged);
  RUN(test_long_name_is_truncated_to_max_chars);
  RUN(test_gap_row_passes_through_with_no_name_processing);
  RUN(test_isMe_flag_is_carried_through);
  RUN(test_empty_input_returns_empty_output);
  RUN(test_name_exactly_at_max_chars_is_not_truncated);
  RUN(test_mixed_gap_and_data_rows_in_one_call);
  RUN(test_winPct_and_streak_pass_through_unchanged);
  RUN(test_matchup_structs_default_to_not_present);
  RUN(test_current_matchup_carries_a_category_list);
  if (g_failures > 0) { std::cerr << g_failures << " failure(s)\n"; return 1; }
  std::cout << "OK\n";
  return 0;
}
