#pragma once
#include <stdint.h>
#include <math.h>

// Modern gojuon: 46 hiragana (no obsolete wi/we or voiced/small kana).
static const char* const KANA[] = {
  "あ","い","う","え","お","か","き","く","け","こ",
  "さ","し","す","せ","そ","た","ち","つ","て","と",
  "な","に","ぬ","ね","の","は","ひ","ふ","へ","ほ",
  "ま","み","む","め","も","や","ゆ","よ",
  "ら","り","る","れ","ろ","わ","を","ん"
};
constexpr int KANA_COUNT = sizeof(KANA) / sizeof(KANA[0]);
constexpr float STEP_DEGREES = 8.0f;
constexpr float TURN_DIRECTION = -1.0f; // Clockwise viewed from above = next.
constexpr float RATE_DEADBAND = 2.5f;
constexpr int TEXT_CAPACITY = 96;

struct KanaInput {
  int selected = 0;
  float residual = 0;
  uint8_t text[TEXT_CAPACITY] = {};
  int length = 0;
  bool rotate(float degrees) {
    residual += degrees;
    bool changed = false;
    while (residual >= STEP_DEGREES) {
      selected = (selected + 1) % KANA_COUNT;
      residual -= STEP_DEGREES;
      changed = true;
    }
    while (residual <= -STEP_DEGREES) {
      selected = (selected + KANA_COUNT - 1) % KANA_COUNT;
      residual += STEP_DEGREES;
      changed = true;
    }
    return changed;
  }
  bool confirm() {
    if (length >= TEXT_CAPACITY) return false;
    text[length++] = selected;
    residual = 0;
    return true;
  }
  bool erase() {
    if (!length) return false;
    --length;
    return true;
  }
  void clear() { length = 0; residual = 0; }
};

struct DebouncedButton {
  uint8_t pin;
  bool raw = false, down = false, pressed = false, released = false;
  uint32_t changedAt = 0, downAt = 0;
  explicit DebouncedButton(uint8_t p) : pin(p) {}
  void update(bool reading, uint32_t now) {
    pressed = released = false;
    if (reading != raw) { raw = reading; changedAt = now; }
    if (down != raw && uint32_t(now - changedAt) >= 30) {
      down = raw;
      pressed = down;
      released = !down;
      if (down) downAt = now;
    }
  }
};
