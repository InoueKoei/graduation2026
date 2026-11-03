#pragma once
#include "LcdTransport.h"
#include <Adafruit_GC9A01A.h>
#include "KanaBitmaps.h"
#include <EEPROM.h>

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
// Main/sub swap: the sub knob (26/15/14) picks kana and drives the LCD, the main knob (6/7/8) picks fonts.
// Kept in flash so it survives power-off; the browser toggles it over USB with 'E' (swap) / 'e' (normal), '?' asks.
constexpr uint8_t SWAP_MAGIC=0xA5;
bool swapEncoders=false;
void reportSwap(){if(Serial)Serial.printf("@SWAP,%u\n",swapEncoders);}
void setSwap(bool swap){
  if(swap!=swapEncoders){swapEncoders=swap;EEPROM.write(0,SWAP_MAGIC);EEPROM.write(1,swap);EEPROM.commit();}
  reportSwap();
}
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

// Styled glyphs from the browser (v2.7). The browser draws all 46 kana in the input's font and weight
// (turned for the LCD mount) and sends them in the background, nearest the selected kana first; turning the dial
// then switches locally, as fast as the built-in Noto. Kana not received yet use Noto.
//   'S'                         start a new set (forget the previous glyphs)
//   'g', index, length (u16 LE) one 192x192 glyph, run-length coded 4-bit grey:
//                               1x yyyyyy = run of black (x=0) or white (x=1), length y+1 (1-64)
//                               0g gggyyy = run of grey g (0-15), length y+1 (1-8)
constexpr unsigned GLYPH_POOL_BYTES=112*1024;
constexpr uint32_t SERIAL_STALL_MS=200;
uint8_t glyphPool[GLYPH_POOL_BYTES];
uint32_t glyphOffset[46];
uint16_t glyphLength[46];
uint64_t glyphReady=0;
unsigned poolUsed=0;
uint8_t incomingKana=0,incomingHeader[3];
unsigned incomingLength=0,incomingBytes=0;
bool incomingStored=false;
uint32_t lastSerialByteAt=0;
enum class SerialState:uint8_t{command,glyphHeader,glyphData};
SerialState serialState=SerialState::command;
uint16_t greyColor(uint8_t level){const uint8_t v=level*17;return uint16_t(((v>>3)<<11)|((v>>2)<<5)|(v>>3));}
void reportGlyph(){if(Serial)Serial.printf("@GLYPHSET,%u,%u\n",KANA_BITMAP_SIZE,GLYPH_POOL_BYTES);}
void forgetGlyphs(){glyphReady=0;poolUsed=0;}
bool glyphStored(uint8_t kana){return kana<46&&(glyphReady>>kana&1);}
// Expands a stored glyph; false (and Noto instead) if the data does not fill the tile exactly.
bool decodeGlyph(uint8_t kana,uint16_t* pixels){
  uint16_t grey[16];for(uint8_t g=0;g<16;++g)grey[g]=greyColor(g);
  const uint8_t* data=glyphPool+glyphOffset[kana];const unsigned total=KANA_BITMAP_SIZE*KANA_BITMAP_SIZE;unsigned at=0;
  for(unsigned i=0;i<glyphLength[kana];++i){
    const uint8_t b=data[i];const uint16_t color=(b&0x80)?((b&0x40)?LCD_INK:LCD_BG):grey[(b>>3)&15];
    const unsigned run=((b&0x80)?(b&0x3F):(b&7))+1;
    if(at+run>total)return false;
    for(unsigned k=0;k<run;++k)pixels[at++]=color;
  }
  return at==total;
}

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
  if(!(glyphStored(selectedKana)&&decodeGlyph(selectedKana,glyphPixels)))
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
  EEPROM.begin(256);
  swapEncoders=EEPROM.read(0)==SWAP_MAGIC&&EEPROM.read(1)==1;
  analogReadResolution(12);
  sizeValue=uint16_t(sizeFiltered=analogRead(SIZE_PIN));
  weightValue=uint16_t(weightFiltered=analogRead(WEIGHT_PIN));
  display.begin(24000000); display.fillScreen(LCD_BG);
  drawSelection();
}

void loop() {
  const uint32_t now = millis();
  const bool connected = bool(Serial);
  // A cut-off image must not swallow later commands.
  if(serialState!=SerialState::command&&uint32_t(now-lastSerialByteAt)>=SERIAL_STALL_MS)serialState=SerialState::command;
  while(Serial.available()){
    lastSerialByteAt=now;
    if(serialState==SerialState::glyphData){
      // Stored straight into the pool; a glyph that does not fit (or a bad index) is read and dropped.
      uint8_t scratch[64];
      const size_t want=min<size_t>(size_t(Serial.available()),incomingLength-incomingBytes);
      if(incomingStored)incomingBytes+=Serial.readBytes(reinterpret_cast<char*>(glyphPool+poolUsed+incomingBytes),want);
      else incomingBytes+=Serial.readBytes(reinterpret_cast<char*>(scratch),min<size_t>(want,sizeof(scratch)));
      if(incomingBytes>=incomingLength){
        serialState=SerialState::command;
        if(incomingStored){
          glyphOffset[incomingKana]=poolUsed;glyphLength[incomingKana]=uint16_t(incomingLength);poolUsed+=incomingLength;
          glyphReady|=uint64_t(1)<<incomingKana;if(incomingKana==selectedKana)displayDirty=true;
        }
      }
      continue;
    }
    const int command=Serial.read();
    if(serialState==SerialState::glyphHeader){
      incomingHeader[incomingBytes++]=uint8_t(command);
      if(incomingBytes==3){
        incomingKana=incomingHeader[0];incomingLength=incomingHeader[1]|(unsigned(incomingHeader[2])<<8);incomingBytes=0;
        incomingStored=incomingKana<46&&poolUsed+incomingLength<=GLYPH_POOL_BYTES;
        if(incomingKana<46)glyphReady&=~(uint64_t(1)<<incomingKana);
        serialState=incomingLength?SerialState::glyphData:SerialState::command;
      }
      continue;
    }
    if(command=='l'){Serial.println("@LCDTEST,WHITE");display.fillScreen(0xFFFF);lcdTestStartedAt=millis();lcdWhiteTest=true;}
    else if(command=='E'||command=='e')setSwap(command=='E');
    else if(command=='?'){reportSwap();reportGlyph();}
    else if(command=='S')forgetGlyphs();
    else if(command=='g'){serialState=SerialState::glyphHeader;incomingBytes=0;}
  }
  if(lcdWhiteTest && uint32_t(millis()-lcdTestStartedAt)>=60000){
    Serial.println("@LCDTEST,BLACK_GLYPH");display.fillScreen(LCD_BG);displayDirty=true;lcdWhiteTest=false;
  }
  if (connected != usbWasConnected) {
    usbWasConnected = connected; singleEventHead = singleEventCount = 0;
    // Without the browser the LCD goes back to the built-in glyphs.
    if(!connected&&glyphReady){forgetGlyphs();serialState=SerialState::command;displayDirty=true;}
    if (connected) {
      Serial.printf("BOOT HeadKana Dial v2.7 RP2040-Zero GC9A01 protocol=5 SWAP=%u FONT=26/15/14 SIZE=29 WEIGHT=28 CLK=GP6 DT=GP7 SW=GP8 SCK=%u MOSI=%u DC=%u CS=%u RST=%u SPI=%s\n",swapEncoders,LCD_SCK,LCD_MOSI,LCD_DC,LCD_CS,LCD_RST,LCD_TRANSPORT_NAME);
      Serial.printf("LCD ready=%u draw_us=%lu font=NotoSansJP white-on-black\n", display.ready, (unsigned long)lastLcdDrawUs);
      reportSwap();reportGlyph();
      transmitter.lastSentAt = now - DIAL_HEARTBEAT_MS;
    }
  }
  int32_t turns,fontTurns;
  noInterrupts(); turns=pendingTurns; pendingTurns=0; fontTurns=pendingFontTurns; pendingFontTurns=0; interrupts();
  if(swapEncoders){const int32_t mainTurns=turns;turns=fontTurns;fontTurns=mainTurns;}
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
  const DialButtonEvent event = button.update(digitalRead(swapEncoders ? FONT_KEY : DIAL_KEY) == LOW, now);
  if (wasDown != button.down) transmitter.selectionChanged();
  if (connected && event != DialButtonEvent::none && singleEventCount < SINGLE_EVENT_QUEUE_SIZE) {
    singleEvents[(singleEventHead + singleEventCount) % SINGLE_EVENT_QUEUE_SIZE] =
      makeTypeFrame(event == DialButtonEvent::confirm ? 0x02 : 0x04);
    ++singleEventCount;
  }
  const bool fontWasDown=fontButton.down;
  const auto fontEvent=fontButton.update(digitalRead(swapEncoders?DIAL_KEY:FONT_KEY)==LOW,now);
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
