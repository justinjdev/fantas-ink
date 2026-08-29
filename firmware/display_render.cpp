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
  display.setTextWrap(false);
  return display;
}

void hibernateDisplay(Display& display) {
  display.hibernate();
}
