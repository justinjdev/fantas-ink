// firmware/display_render.cpp
#include "display_render.h"
#include <SPI.h>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>
#include <Fonts/FreeMono9pt7b.h>
#include <Fonts/FreeMono12pt7b.h>
#include <Fonts/FreeMonoBold12pt7b.h>
#include <Fonts/FreeMonoBold18pt7b.h>

// Pins confirmed against Waveshare's ESP32 e-Paper Driver Board wiki and
// GxEPD2's ConnectingHardware.md — see design spec's Hardware section.
static const int PIN_EPD_CS = 15;
static const int PIN_EPD_DC = 27;
static const int PIN_EPD_RST = 26;
static const int PIN_EPD_BUSY = 25;
static const int PIN_SPI_SCK = 13;
static const int PIN_SPI_MISO = 12; // unused by the panel (write-only), required by SPIClass::begin's signature
static const int PIN_SPI_MOSI = 14;

enum class Align { Left, Center, Right };

static void printAligned(Display& display, const std::string& text, int x, int y, Align align = Align::Left) {
  int16_t tbx, tby;
  uint16_t tbw, tbh;
  display.getTextBounds(text.c_str(), 0, 0, &tbx, &tby, &tbw, &tbh);
  int drawX = x;
  if (align == Align::Right) drawX = x - static_cast<int>(tbw);
  else if (align == Align::Center) drawX = x - static_cast<int>(tbw) / 2;
  display.setCursor(drawX, y);
  display.print(text.c_str());
}

static void hrule(Display& display, int x1, int y, int x2) {
  display.fillRect(x1, y, x2 - x1, 1, GxEPD_BLACK);
}

static void vrule(Display& display, int x, int y1, int y2) {
  display.fillRect(x, y1, 1, y2 - y1, GxEPD_BLACK);
}

static SPIClass hspi(HSPI);

// The Display object embeds a ~48KB framebuffer as a member array, which is
// larger than loopTask's 8192-byte stack (ARDUINO_LOOP_STACK_SIZE). It must
// live in static storage, and initDisplay() must hand back a reference —
// returning by value would put a copy right back on the caller's stack.
static Display display(GxEPD2_750_GDEY075T7(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

Display& initDisplay() {
  hspi.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, PIN_EPD_CS);
  display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  display.init(115200);
  display.setRotation(0);
  return display;
}

constexpr size_t MAX_LEAGUE_NAME_CHARS = 24;

static std::string truncateToFit(const std::string& text, size_t maxChars) {
  return text.size() > maxChars ? text.substr(0, maxChars) : text;
}

static void drawStandingsTable(Display& display, const std::vector<LayoutRow>& rows,
                                bool hasPlayoffTeams, int playoffTeams) {
  const int top = 74, rowH = 40;
  const int rankX = 20, teamX = 56, wltX = 235, pctX = 315, strkX = 385;

  int y = top;
  bool prevWasGap = false;
  for (const auto& row : rows) {
    if (row.isGap) {
      hrule(display, teamX, y + rowH / 2, 440);
      y += rowH;
      prevWasGap = true;
      continue;
    }
    if (hasPlayoffTeams && row.rank == playoffTeams + 1 && !prevWasGap) {
      for (int x = 56; x < 440; x += 10) display.fillRect(x, y, 6, 2, GxEPD_BLACK);
    }
    prevWasGap = false;

    const int baseline = y + rowH / 2 + 7;
    if (row.isMe) {
      display.fillRect(16, y + 2, 432, rowH - 6, GxEPD_BLACK);
      display.setTextColor(GxEPD_WHITE);
    } else {
      display.setTextColor(GxEPD_BLACK);
    }

    display.setFont(&FreeMonoBold12pt7b);
    printAligned(display, std::to_string(row.rank), rankX, baseline);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, row.displayName, teamX, baseline);
    display.setFont(row.isMe ? &FreeMonoBold12pt7b : &FreeMono12pt7b);
    printAligned(display, std::to_string(row.wins) + "-" + std::to_string(row.losses) + "-" + std::to_string(row.ties), wltX, baseline);
    printAligned(display, row.winPct, pctX, baseline);
    printAligned(display, row.streak, strkX, baseline);

    y += rowH;
  }
  display.setTextColor(GxEPD_BLACK);
}

static void drawMatchupBlock(Display& display, int topY, int bottomY, const char* eyebrow,
                              const std::string& statusWord, const std::string& oppName,
                              const std::string& tally, const std::string& caption, bool big) {
  const int sx = 484;
  const int midY = (topY + bottomY) / 2;
  const int eyebrowOffset = 20;

  display.setFont(&FreeSansBold9pt7b);
  printAligned(display, eyebrow, sx, topY + eyebrowOffset);

  if (big) {
    display.setFont(&FreeSansBold18pt7b);
    printAligned(display, statusWord, sx, midY - 4);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "vs " + oppName, sx, midY + 19);
    display.setFont(&FreeMonoBold18pt7b);
    printAligned(display, tally, sx, midY + 46);
    display.setFont(&FreeSans9pt7b);
    printAligned(display, caption, sx, midY + 63);
  } else {
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, statusWord + " vs " + oppName, sx, midY + 8);
    display.setFont(&FreeMonoBold12pt7b);
    printAligned(display, tally, sx, midY + 30);
  }
}

static void drawMatchupSidebar(Display& display, const CurrentMatchup& current, const MatchupSummary& last,
                                const NextMatchup& next) {
  const int sbTop = 64, sbBottom = 452;
  const int thisWeekEnd = sbTop + static_cast<int>((sbBottom - sbTop) * 0.4f);
  const int lastWeekEnd = thisWeekEnd + static_cast<int>((sbBottom - sbTop) * 0.3f);
  hrule(display, 460, thisWeekEnd, 780);
  hrule(display, 460, lastWeekEnd, 780);

  if (current.present) {
    drawMatchupBlock(display, sbTop, thisWeekEnd, "THIS WEEK", current.status, current.opponent,
                      current.tally, "categories ahead-behind-tied", true);
  } else {
    display.setFont(&FreeSansBold9pt7b);
    printAligned(display, "THIS WEEK", 484, sbTop + 20);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "No matchup this week", 484, (sbTop + thisWeekEnd) / 2);
  }

  if (last.present) {
    drawMatchupBlock(display, thisWeekEnd, lastWeekEnd, "LAST WEEK", last.status, last.opponent,
                      last.tally, "", false);
  } else {
    display.setFont(&FreeSansBold9pt7b);
    printAligned(display, "LAST WEEK", 484, thisWeekEnd + 20);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "No result last week", 484, (thisWeekEnd + lastWeekEnd) / 2 + 8);
  }

  if (next.present) {
    display.setFont(&FreeSansBold9pt7b);
    printAligned(display, "NEXT WEEK", 484, lastWeekEnd + 20);
    const int midY = (lastWeekEnd + 452) / 2;
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "vs " + next.opponent, 484, midY + 8);
    display.setFont(&FreeMono9pt7b);
    printAligned(display, "Their record: " + next.opponentRecord, 484, midY + 30);
  } else {
    display.setFont(&FreeSansBold9pt7b);
    printAligned(display, "NEXT WEEK", 484, lastWeekEnd + 20);
    display.setFont(&FreeSansBold12pt7b);
    printAligned(display, "No matchup scheduled", 484, (lastWeekEnd + 452) / 2 + 8);
  }
}

void renderStandingsPage(Display& display, const std::string& leagueName, const std::vector<LayoutRow>& rows,
                          bool hasPlayoffTeams, int playoffTeams, const CurrentMatchup& current,
                          const MatchupSummary& last, const NextMatchup& next, const std::string& footer) {
  display.setTextColor(GxEPD_BLACK);
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);

    display.setFont(&FreeSansBold24pt7b);
    printAligned(display, truncateToFit(leagueName, MAX_LEAGUE_NAME_CHARS), 20, 40);
    hrule(display, 20, 54, 780);
    vrule(display, 460, 64, 452);

    drawStandingsTable(display, rows, hasPlayoffTeams, playoffTeams);
    drawMatchupSidebar(display, current, last, next);

    hrule(display, 20, 452, 780);
    display.setFont(&FreeSans9pt7b);
    if (!footer.empty()) printAligned(display, footer, 20, 468);
    printAligned(display, "PAGE 1/2 - button > categories", 780, 468, Align::Right);
  } while (display.nextPage());
}

void renderMessage(Display& display, const std::string& message) {
  display.setTextColor(GxEPD_BLACK);
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(20, display.height() / 2);
    display.print(message.c_str());
  } while (display.nextPage());
}

void hibernateDisplay(Display& display) {
  display.hibernate();
}
