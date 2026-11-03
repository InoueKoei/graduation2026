#pragma once
#include "LcdTransport.h"
#include <Adafruit_GC9A01A.h>
#include "KanaBitmaps.h"

constexpr uint8_t DIAL_A = 6, DIAL_B = 7, DIAL_KEY = 8;
RotaryEncoder encoder;
DialButton button;
DialTransmitScheduler transmitter;
volatile int32_t pendingTurns = 0;
volatile uint32_t mainSignalEdges=0;
uint32_t lastInputDiagnosticAt=0;
uint8_t selectedKana = 0;
uint16_t sequence = 0;
bool usbWasConnected = false;
uint16_t glyphPixels[KANA_BITMAP_SIZE * KANA_BITMAP_SIZE];
uint32_t lastLcdDrawUs=0, lastLcdDiagnosticAt=0;
bool displayDirty = true, shownPressed = false;
uint32_t lastDisplayAt = 0;
constexpr uint16_t LCD_BG = 0x0000, LCD_INK = 0xFFFF, LCD_ACCENT = 0xFFFF;

struct SingleDialFrame { uint8_t flags, selected; };
constexpr uint8_t SINGLE_EVENT_QUEUE_SIZE = 32;
SingleDialFrame singleEvents[SINGLE_EVENT_QUEUE_SIZE];
uint8_t singleEventHead = 0, singleEventCount = 0;

void singleEncoderChanged() {
  ++mainSignalEdges;
  const uint32_t pins = gpio_get_all();
  pendingTurns += encoder.update((pins >> DIAL_A) & 1, (pins >> DIAL_B) & 1);
}

void drawSelection() {
  for (unsigned i = 0; i < KANA_BITMAP_SIZE * KANA_BITMAP_SIZE; ++i)
    glyphPixels[i] = (KANA_BITMAPS[selectedKana][i >> 3] & (0x80 >> (i & 7))) ? LCD_INK : LCD_BG;
  const uint32_t before=micros();
  display.bitmap(glyphPixels,KANA_BITMAP_SIZE);
  lastLcdDrawUs=micros()-before;
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
  display.begin(24000000); display.fillScreen(LCD_BG);
  drawSelection();
}

void loop() {
  const uint32_t now = millis();
  const bool connected = bool(Serial);
  if (connected != usbWasConnected) {
    usbWasConnected = connected; singleEventHead = singleEventCount = 0;
    if (connected) {
      Serial.printf("BOOT HeadKana Dial v2.0 RP2040-Zero GC9A01 protocol=4 CLK=GP6 DT=GP7 SW=GP8 SCK=%u MOSI=%u DC=%u CS=%u RST=%u SPI=%s\n",LCD_SCK,LCD_MOSI,LCD_DC,LCD_CS,LCD_RST,LCD_TRANSPORT_NAME);
      Serial.printf("LCD ready=%u draw_us=%lu font=NotoSansJP white-on-black\n", display.ready, (unsigned long)lastLcdDrawUs);
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
  }
  if (displayDirty && uint32_t(now - lastDisplayAt) >= 25) { lastDisplayAt = now; drawSelection(); }
  if(connected && uint32_t(now-lastLcdDiagnosticAt)>=5000 && Serial.availableForWrite()>=64){
    lastLcdDiagnosticAt=now;Serial.printf("@LCD,%lu,%u\n",(unsigned long)lastLcdDrawUs,display.ready);
  }
  if(connected && uint32_t(now-lastInputDiagnosticAt)>=250 && Serial.availableForWrite()>=64){
    lastInputDiagnosticAt=now;Serial.printf("@IO,%u,%u,%u,%lu\n",digitalRead(DIAL_A),digitalRead(DIAL_B),digitalRead(DIAL_KEY),(unsigned long)mainSignalEdges);
  }
  delay(1);
}
