#pragma once
#include "LcdTransport.h"
#include <Adafruit_GC9A01A.h>
#include "KanaBitmaps.h"

constexpr uint8_t DIAL_A = 6, DIAL_B = 7, DIAL_KEY = 8;
constexpr uint8_t FONT_A=26, FONT_B=15, FONT_KEY=14, SIZE_PIN=29, WEIGHT_PIN=28;
RotaryEncoder fontEncoder;
DialButton fontButton;
volatile int32_t pendingFontTurns=0;
volatile uint32_t subClkEdges=0,subDtEdges=0;
volatile uint8_t subAbMask=0;
uint32_t lastSubDiagnosticAt=0;
uint16_t fontCounter=0, sizeValue=0, weightValue=0;
float sizeFiltered=0, weightFiltered=0;
uint32_t lastAnalogAt=0;
RotaryEncoder encoder;
DialButton button;
DialTransmitScheduler transmitter;
volatile int32_t pendingTurns = 0;
volatile uint32_t mainSignalEdges=0, clkSignalEdges=0,dtSignalEdges=0;
volatile uint8_t mainAbMask=0;
uint32_t lastInputDiagnosticAt=0;
uint8_t selectedKana = 0;
uint16_t sequence = 0;
bool usbWasConnected = false;
uint16_t glyphPixels[KANA_BITMAP_SIZE * KANA_BITMAP_SIZE];
uint32_t lastLcdDrawUs=0, lastLcdDiagnosticAt=0;
uint32_t lcdTestStartedAt=0;
bool lcdWhiteTest=false;
bool displayDirty = true, shownPressed = false;
uint32_t lastDisplayAt = 0;
constexpr uint16_t LCD_BG = 0x0000, LCD_INK = 0xFFFF, LCD_ACCENT = 0xFFFF;

struct SingleDialFrame { uint8_t flags, selected; uint16_t font, size, weight; uint8_t fontPressed; };
constexpr uint8_t SINGLE_EVENT_QUEUE_SIZE = 32;
SingleDialFrame singleEvents[SINGLE_EVENT_QUEUE_SIZE];
uint8_t singleEventHead = 0, singleEventCount = 0;

void singleEncoderChanged() {
  ++mainSignalEdges;
  const uint32_t pins = gpio_get_all();
  const uint8_t ab=(((pins>>DIAL_A)&1)<<1)|((pins>>DIAL_B)&1);
  const uint8_t changed=ab^encoder.previous;
  if(changed&2)++clkSignalEdges;if(changed&1)++dtSignalEdges;
  mainAbMask|=uint8_t(1u<<ab);
  pendingTurns += encoder.update((pins >> DIAL_A) & 1, (pins >> DIAL_B) & 1);
}

void fontEncoderChanged() {
  const uint32_t pins=gpio_get_all();
  const uint8_t ab=(((pins>>FONT_A)&1)<<1)|((pins>>FONT_B)&1);
  const uint8_t changed=ab^fontEncoder.previous;
  if(changed&2)++subClkEdges;if(changed&1)++subDtEdges;
  subAbMask|=uint8_t(1u<<ab);
  pendingFontTurns+=fontEncoder.update((pins>>FONT_A)&1,(pins>>FONT_B)&1);
}
SingleDialFrame makeTypeFrame(uint8_t eventFlags=0) {
  return {uint8_t(1|eventFlags|(button.down?8:0)),selectedKana,fontCounter,sizeValue,weightValue,uint8_t(fontButton.down)};
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
  const int length = snprintf(line, sizeof(line), "@T,%u,%u,%u,%u,%u,%u,%u\n", frame.flags, frame.selected, nextSequence, frame.font, frame.size, frame.weight, frame.fontPressed);
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
  pinMode(FONT_A,INPUT_PULLUP); pinMode(FONT_B,INPUT_PULLUP); pinMode(FONT_KEY,INPUT_PULLUP);
  fontEncoder.begin(digitalRead(FONT_A),digitalRead(FONT_B));
  attachInterrupt(digitalPinToInterrupt(FONT_A),fontEncoderChanged,CHANGE);
  attachInterrupt(digitalPinToInterrupt(FONT_B),fontEncoderChanged,CHANGE);
  analogReadResolution(12);
  sizeValue=uint16_t(sizeFiltered=analogRead(SIZE_PIN));
  weightValue=uint16_t(weightFiltered=analogRead(WEIGHT_PIN));
  display.begin(24000000); display.fillScreen(LCD_BG);
  drawSelection();
}

void loop() {
  const uint32_t now = millis();
  const bool connected = bool(Serial);
  if(Serial.available() && Serial.read()=='l'){
    Serial.println("@LCDTEST,WHITE");display.fillScreen(0xFFFF);lcdTestStartedAt=millis();lcdWhiteTest=true;
  }
  if(lcdWhiteTest && uint32_t(millis()-lcdTestStartedAt)>=60000){
    Serial.println("@LCDTEST,BLACK_GLYPH");display.fillScreen(LCD_BG);displayDirty=true;lcdWhiteTest=false;
  }
  if (connected != usbWasConnected) {
    usbWasConnected = connected; singleEventHead = singleEventCount = 0;
    if (connected) {
      Serial.printf("BOOT HeadKana Dial v2.4 RP2040-Zero GC9A01 protocol=5 FONT=26/15/14 SIZE=29 WEIGHT=28 CLK=GP6 DT=GP7 SW=GP8 SCK=%u MOSI=%u DC=%u CS=%u RST=%u SPI=%s\n",LCD_SCK,LCD_MOSI,LCD_DC,LCD_CS,LCD_RST,LCD_TRANSPORT_NAME);
      Serial.printf("LCD ready=%u draw_us=%lu font=NotoSansJP white-on-black\n", display.ready, (unsigned long)lastLcdDrawUs);
      transmitter.lastSentAt = now - DIAL_HEARTBEAT_MS;
    }
  }
  int32_t turns,fontTurns;
  noInterrupts(); turns=pendingTurns; pendingTurns=0; fontTurns=pendingFontTurns; pendingFontTurns=0; interrupts();
  if(fontTurns){fontCounter=uint16_t(fontCounter+fontTurns);transmitter.selectionChanged();}
  if(uint32_t(now-lastAnalogAt)>=5){
    lastAnalogAt=now;
    sizeFiltered+=(analogRead(SIZE_PIN)-sizeFiltered)*0.2f;
    weightFiltered+=(analogRead(WEIGHT_PIN)-weightFiltered)*0.2f;
    const uint16_t sz=uint16_t(sizeFiltered+0.5f),wt=uint16_t(weightFiltered+0.5f);
    // Hold the last reported value inside an ADC deadband; snap near physical endpoints.
    const uint16_t nextSize=sz<24?0:sz>4071?4095:sz;
    const uint16_t nextWeight=wt<24?0:wt>4071?4095:wt;
    if(abs(int(nextSize)-int(sizeValue))>=16){sizeValue=nextSize;transmitter.selectionChanged();}
    if(abs(int(nextWeight)-int(weightValue))>=16){weightValue=nextWeight;transmitter.selectionChanged();}
  }
  if (turns) {
    selectedKana = (int32_t(selectedKana) + turns % 46 + 46) % 46;
    displayDirty = true; transmitter.selectionChanged();
  }
  const bool wasDown = button.down;
  const DialButtonEvent event = button.update(digitalRead(DIAL_KEY) == LOW, now);
  if (wasDown != button.down) transmitter.selectionChanged();
  if (connected && event != DialButtonEvent::none && singleEventCount < SINGLE_EVENT_QUEUE_SIZE) {
    singleEvents[(singleEventHead + singleEventCount) % SINGLE_EVENT_QUEUE_SIZE] =
      makeTypeFrame(event == DialButtonEvent::confirm ? 0x02 : 0x04);
    ++singleEventCount;
  }
  const bool fontWasDown=fontButton.down;
  const auto fontEvent=fontButton.update(digitalRead(FONT_KEY)==LOW,now);
  if(fontWasDown!=fontButton.down)transmitter.selectionChanged();
  if(connected&&fontEvent==DialButtonEvent::confirm&&singleEventCount<SINGLE_EVENT_QUEUE_SIZE){
    singleEvents[(singleEventHead+singleEventCount)%SINGLE_EVENT_QUEUE_SIZE]=makeTypeFrame(0x10);
    ++singleEventCount;
  }
  while (singleEventCount && sendSingleFrame(singleEvents[singleEventHead])) {
    singleEventHead = (singleEventHead + 1) % SINGLE_EVENT_QUEUE_SIZE; --singleEventCount;
  }
  if (!singleEventCount && transmitter.due(now) && sendSingleFrame(makeTypeFrame())) transmitter.consume(now);
  if (shownPressed != button.down) {
    shownPressed = button.down;
  }
  if (!lcdWhiteTest && displayDirty && uint32_t(now - lastDisplayAt) >= 25) { lastDisplayAt = now; drawSelection(); }
  if(connected && uint32_t(now-lastLcdDiagnosticAt)>=5000 && Serial.availableForWrite()>=64){
    lastLcdDiagnosticAt=now;Serial.printf("@LCD,%lu,%u\n",(unsigned long)lastLcdDrawUs,display.ready);
  }
  if(connected && uint32_t(now-lastInputDiagnosticAt)>=250 && Serial.availableForWrite()>=64){
    lastInputDiagnosticAt=now;Serial.printf("@IO,%u,%u,%u,%lu\n",digitalRead(DIAL_A),digitalRead(DIAL_B),digitalRead(DIAL_KEY),(unsigned long)mainSignalEdges);
  }
  if(connected && Serial.availableForWrite()>=64 && uint32_t(now-lastInputDiagnosticAt)<2){
    Serial.printf("@ENC,%lu,%lu,%u,%d\n",(unsigned long)clkSignalEdges,(unsigned long)dtSignalEdges,mainAbMask,encoder.quarterSteps);
  }
  if(connected && Serial.availableForWrite()>=64 && uint32_t(now-lastSubDiagnosticAt)>=250){
    lastSubDiagnosticAt=now;
    Serial.printf("@SUBIO,%u,%u,%u,%lu,%lu,%u\n",digitalRead(FONT_A),digitalRead(FONT_B),digitalRead(FONT_KEY),(unsigned long)subClkEdges,(unsigned long)subDtEdges,subAbMask);
  }
  delay(1);
}
