// firmware/preview/Adafruit_GFX.h
//
// Host-only stand-in for Adafruit_GFX.h, used ONLY by the desktop preview
// build (see README's "Host preview" section). The real Adafruit_GFX_Library
// Fonts/*.h files (used here unmodified, for pixel-identical text) hardcode
// `#include <Adafruit_GFX.h>`, so this file must have that exact name and
// sit earlier on the include path than the real library's Fonts/ directory.
//
// This implements only the subset of Adafruit_GFX's API that
// firmware/display_render.h actually calls (custom GFXfont text only — the
// device never sets a null font, so the classic 5x7 bitmap font path is not
// implemented here). It is not a general Adafruit_GFX replacement.
#pragma once
#include <cstdint>
#include <cstddef>

#define PROGMEM

typedef struct {
  uint16_t bitmapOffset;
  uint8_t width, height;
  uint8_t xAdvance;
  int8_t xOffset, yOffset;
} GFXglyph;

typedef struct {
  uint8_t* bitmap;
  GFXglyph* glyph;
  uint16_t first, last;
  uint8_t yAdvance;
} GFXfont;

class Adafruit_GFX {
 public:
  Adafruit_GFX(int16_t w, int16_t h) : _width(w), _height(h) {}
  virtual ~Adafruit_GFX() = default;

  virtual void drawPixel(int16_t x, int16_t y, uint16_t color) = 0;

  virtual void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    for (int16_t j = 0; j < h; j++)
      for (int16_t i = 0; i < w; i++) drawPixel(x + i, y + j, color);
  }

  void fillScreen(uint16_t color) { fillRect(0, 0, _width, _height, color); }

  void setFont(const GFXfont* f) { gfxFont = f; }
  void setTextColor(uint16_t c) { textcolor = c; }
  void setCursor(int16_t x, int16_t y) { cursor_x = x; cursor_y = y; }
  void setTextWrap(bool w) { wrap = w; }

  int16_t width() const { return _width; }
  int16_t height() const { return _height; }

  size_t print(const char* str) {
    while (*str) write(static_cast<uint8_t>(*str++));
    return 1;
  }

  // Mirrors Adafruit_GFX::write()'s custom-font branch.
  void write(uint8_t c) {
    if (!gfxFont) return;
    if (c == '\n') {
      cursor_x = 0;
      cursor_y += gfxFont->yAdvance;
      return;
    }
    if (c == '\r' || c < gfxFont->first || c > gfxFont->last) return;
    drawChar(cursor_x, cursor_y, c);
    cursor_x += gfxFont->glyph[c - gfxFont->first].xAdvance;
  }

  // Mirrors Adafruit_GFX::charBounds()'s custom-font branch, folded into
  // getTextBounds() directly since nothing here needs the split.
  void getTextBounds(const char* str, int16_t x, int16_t y, int16_t* x1, int16_t* y1, uint16_t* w, uint16_t* h) const {
    int16_t minx = 0x7FFF, miny = 0x7FFF, maxx = -1, maxy = -1;
    int16_t cx = x, cy = y;
    *x1 = x; *y1 = y; *w = *h = 0;
    if (!gfxFont) return;
    for (const char* p = str; *p; p++) {
      uint8_t c = static_cast<uint8_t>(*p);
      if (c == '\n') { cx = x; cy += gfxFont->yAdvance; continue; }
      if (c == '\r' || c < gfxFont->first || c > gfxFont->last) continue;
      const GFXglyph& glyph = gfxFont->glyph[c - gfxFont->first];
      int16_t gx1 = cx + glyph.xOffset, gy1 = cy + glyph.yOffset;
      int16_t gx2 = gx1 + glyph.width - 1, gy2 = gy1 + glyph.height - 1;
      if (gx1 < minx) minx = gx1;
      if (gy1 < miny) miny = gy1;
      if (gx2 > maxx) maxx = gx2;
      if (gy2 > maxy) maxy = gy2;
      cx += glyph.xAdvance;
    }
    if (maxx >= minx) { *x1 = minx; *w = maxx - minx + 1; }
    if (maxy >= miny) { *y1 = miny; *h = maxy - miny + 1; }
  }

 protected:
  int16_t _width, _height;
  int16_t cursor_x = 0, cursor_y = 0;
  uint16_t textcolor = 0;
  bool wrap = true;
  const GFXfont* gfxFont = nullptr;

 private:
  // Mirrors Adafruit_GFX::drawChar()'s custom-font branch.
  void drawChar(int16_t x, int16_t y, uint8_t c) {
    const GFXglyph& glyph = gfxFont->glyph[c - gfxFont->first];
    const uint8_t* bitmap = gfxFont->bitmap;
    uint16_t bo = glyph.bitmapOffset;
    uint8_t bits = 0, bit = 0;
    for (uint8_t yy = 0; yy < glyph.height; yy++) {
      for (uint8_t xx = 0; xx < glyph.width; xx++) {
        if (!(bit++ & 7)) bits = bitmap[bo++];
        if (bits & 0x80) drawPixel(x + glyph.xOffset + xx, y + glyph.yOffset + yy, textcolor);
        bits <<= 1;
      }
    }
  }
};
