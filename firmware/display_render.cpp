// firmware/display_render.cpp
#include "display_render.h"
#include <SPI.h>

// Pins confirmed against Waveshare's ESP32 e-Paper Driver Board wiki and
// GxEPD2's ConnectingHardware.md — see design spec's Hardware section.
static const int PIN_EPD_CS = 15;
static const int PIN_EPD_DC = 27;
static const int PIN_EPD_RST = 26;
static const int PIN_EPD_BUSY = 25;
static const int PIN_SPI_SCK = 13;
static const int PIN_SPI_MISO = 12; // unused by the panel (write-only), required by SPIClass::begin's signature
static const int PIN_SPI_MOSI = 14;

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

static const int ROW_HEIGHT = 26;
static const int TOP_MARGIN = 8;
static const int COL_RANK_X = 4;
static const int COL_NAME_X = 32;
static const int COL_RECORD_X = 300;

static void drawRow(Display& display, int y, const LayoutRow& row) {
  if (row.isMe) {
    display.drawRect(0, y - 2, display.width(), ROW_HEIGHT - 2, GxEPD_BLACK);
  }
  display.setCursor(COL_RANK_X, y + 16);
  display.print(row.rank);
  display.setCursor(COL_NAME_X, y + 16);
  display.print(row.displayName.c_str());
  display.setCursor(COL_RECORD_X, y + 16);
  display.print(row.wins);
  display.print('-');
  display.print(row.losses);
  display.print('-');
  display.print(row.ties);
}

static void drawGap(Display& display, int y) {
  for (int x = 4; x < display.width() - 4; x += 8) {
    display.drawFastHLine(x, y + ROW_HEIGHT / 2, 4, GxEPD_BLACK);
  }
}

void renderLayout(Display& display, const std::vector<LayoutRow>& rows, const std::string& footer) {
  display.setTextColor(GxEPD_BLACK);
  display.setTextSize(1);
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    int y = TOP_MARGIN;
    for (const auto& row : rows) {
      if (row.isGap) {
        drawGap(display, y);
      } else {
        drawRow(display, y, row);
      }
      y += ROW_HEIGHT;
    }
    if (!footer.empty()) {
      display.setCursor(4, display.height() - 8);
      display.print(footer.c_str());
    }
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
