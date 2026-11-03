#pragma once
// Fixed physical wiring confirmed by user: RST1 CS2 DC3 SDA4 SCL5.
// Normal builds use this pinout. Do not substitute the earlier prototype SPI0 pinout.
#if defined(HEADKANA_LCD_SOFT)
#include <Adafruit_GC9A01A.h>
constexpr const char* LCD_TRANSPORT_NAME="SOFT-FIXED12345";
constexpr uint8_t LCD_RST=1,LCD_CS=2,LCD_DC=3,LCD_MOSI=4,LCD_SCK=5;
class KanaLcd {
  Adafruit_GC9A01A panel{LCD_CS,LCD_DC,LCD_MOSI,LCD_SCK,LCD_RST};
public:
  bool ready=false;
  bool begin(uint32_t frequency){panel.begin(frequency);ready=true;return true;}
  void fillScreen(uint16_t color){panel.fillScreen(color);}
  void bitmap(const uint16_t* pixels,uint16_t size){
    panel.startWrite();
    for(unsigned y=0;y<size;++y){unsigned x=0;while(x<size){unsigned first=x;uint16_t color=pixels[y*size+x++];while(x<size&&pixels[y*size+x]==color)++x;panel.writeFastHLine((240-size)/2+first,(240-size)/2+y,x-first,color);}}
    panel.endWrite();
  }
};
KanaLcd display;
#else
#include "LcdPioTransport.h"
constexpr const char* LCD_TRANSPORT_NAME="PIO-FIXED12345";
#endif
