#pragma once
#include <SPI.h>
#include <Adafruit_GC9A01A.h>
#include "KanaBitmaps.h"

constexpr uint8_t LCD_SCK = 2, LCD_MOSI = 3, LCD_DC = 4, LCD_CS = 5, LCD_RST = 1;
constexpr uint8_t DIAL_A = 6, DIAL_B = 7, DIAL_KEY = 8;
Adafruit_GC9A01A display(&SPI, LCD_DC, LCD_CS, LCD_RST);
RotaryEncoder encoder;
DialButton button;
DialTransmitScheduler transmitter;
volatile int32_t pendingTurns = 0;
uint8_t selectedKana = 0;
uint16_t sequence = 0;
bool usbWasConnected = false;
uint16_t glyphPixels[128 * 128];
bool displayDirty = true, shownPressed = false;
uint32_t lastDisplayAt = 0;
constexpr uint16_t LCD_BG = 0xFFFF, LCD_INK = 0x21E9, LCD_ACCENT = 0x3BD0;

struct SingleDialFrame { uint8_t flags, selected; };
constexpr uint8_t SINGLE_EVENT_QUEUE_SIZE = 32;
SingleDialFrame singleEvents[SINGLE_EVENT_QUEUE_SIZE];
uint8_t singleEventHead = 0, singleEventCount = 0;

void singleEncoderChanged() {
  const uint32_t pins = gpio_get_all();
  pendingTurns += encoder.update((pins >> DIAL_A) & 1, (pins >> DIAL_B) & 1);
}

void drawSelection() {
  for (unsigned i = 0; i < 128 * 128; ++i)
    glyphPixels[i] = (KANA_BITMAPS[selectedKana][i >> 3] & (0x80 >> (i & 7))) ? LCD_INK : LCD_BG;
  display.drawRGBBitmap(56, 56, glyphPixels, 128, 128);
  display.fillRect(74, 196, 92, 20, LCD_BG);
  display.setTextColor(LCD_ACCENT, LCD_BG); display.setTextSize(2);
  display.setCursor(selectedKana < 9 ? 85 : 79, 198);
  display.print(selectedKana + 1); display.print(" / 46");
  displayDirty = false;
}

uint8_t singleFlags(uint8_t eventFlags = 0) { return 0x01 | eventFlags | (button.down ? 0x08 : 0); }
bool sendSingleFrame(SingleDialFrame frame) {
  if (!Serial) return false;
  const uint16_t nextSequence = sequence + 1;
  char line[64];
  const int length = snprintf(line, sizeof(line), "@S,%u,%u,%u\n", frame.flags, frame.selected, nextSequence);
  if (Serial.availableForWrite() < length) return false;
  if (Serial.write(reinterpret_cast<const uint8_t*>(line), length) != size_t(length)) return false;
  sequence = nextSequence; return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(DIAL_A, INPUT_PULLUP); pinMode(DIAL_B, INPUT_PULLUP); pinMode(DIAL_KEY, INPUT_PULLUP);
  encoder.begin(digitalRead(DIAL_A), digitalRead(DIAL_B));
  attachInterrupt(digitalPinToInterrupt(DIAL_A), singleEncoderChanged, CHANGE);
  attachInterrupt(digitalPinToInterrupt(DIAL_B), singleEncoderChanged, CHANGE);
  SPI.setSCK(LCD_SCK); SPI.setTX(LCD_MOSI); SPI.setRX(0);
  display.begin(24000000); display.setRotation(0); display.fillScreen(LCD_BG);
  display.drawCircle(120, 120, 116, LCD_ACCENT);
  display.setTextColor(LCD_ACCENT, LCD_BG); display.setTextSize(1); display.setCursor(85, 30); display.print("HEAD KANA");
  drawSelection();
}

void loop() {
  const uint32_t now = millis();
  const bool connected = bool(Serial);
  if (connected != usbWasConnected) {
    usbWasConnected = connected; singleEventHead = singleEventCount = 0;
    if (connected) {
      Serial.println("BOOT HeadKana Dial v1.7 RP2040-Zero single-lcd GC9A01 protocol=4 A=GP6 B=GP7 KEY=GP8 SCK=GP2 MOSI=GP3 DC=GP4 CS=GP5 RST=GP1");
      transmitter.lastSentAt = now - DIAL_HEARTBEAT_MS;
    }
  }
  int32_t turns;
  noInterrupts(); turns = pendingTurns; pendingTurns = 0; interrupts();
  if (turns) {
    selectedKana = (int32_t(selectedKana) + turns % 46 + 46) % 46;
    displayDirty = true; transmitter.selectionChanged();
  }
  const bool wasDown = button.down;
  const DialButtonEvent event = button.update(digitalRead(DIAL_KEY) == LOW, now);
  if (wasDown != button.down) transmitter.selectionChanged();
  if (connected && event != DialButtonEvent::none && singleEventCount < SINGLE_EVENT_QUEUE_SIZE) {
    singleEvents[(singleEventHead + singleEventCount) % SINGLE_EVENT_QUEUE_SIZE] =
      {singleFlags(event == DialButtonEvent::confirm ? 0x02 : 0x04), selectedKana};
    ++singleEventCount;
  }
  while (singleEventCount && sendSingleFrame(singleEvents[singleEventHead])) {
    singleEventHead = (singleEventHead + 1) % SINGLE_EVENT_QUEUE_SIZE; --singleEventCount;
  }
  if (!singleEventCount && transmitter.due(now) && sendSingleFrame({singleFlags(), selectedKana})) transmitter.consume(now);
  if (shownPressed != button.down) {
    shownPressed = button.down;
    display.drawCircle(120, 120, 114, button.down ? LCD_ACCENT : LCD_BG);
  }
  if (displayDirty && uint32_t(now - lastDisplayAt) >= 25) { lastDisplayAt = now; drawSelection(); }
  delay(1);
}
