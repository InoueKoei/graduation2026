#pragma once
#include <Arduino.h>
#include <SoftwareSPI.h> // Exposes the core PIO SPI program include path.
#include <spi.pio.h>
#include <Adafruit_GC9A01A.h> // Register constants only; bulk transfers below use PIO directly.
#include "LcdInit.h"
constexpr uint8_t LCD_RST=1,LCD_CS=2,LCD_DC=3,LCD_MOSI=4,LCD_SCK=5;
class KanaLcd {
  PIOProgram program{&spi_cpha0_program};
  PIO pio=nullptr;int sm=0,offset=0;
  void bytes(const uint8_t* data,size_t count){
    if(!ready)return;
    io_rw_8* tx=(io_rw_8*)&pio->txf[sm];io_rw_8* rx=(io_rw_8*)&pio->rxf[sm];
    size_t sent=0,received=0;
    while(received<count){
      while(sent<count&&!pio_sm_is_tx_fifo_full(pio,sm))*tx=data[sent++];
      while(received<count&&!pio_sm_is_rx_fifo_empty(pio,sm)){(void)*rx;++received;}
    }
  }
  void command(uint8_t cmd,const uint8_t* data=nullptr,size_t size=0){
    digitalWrite(LCD_CS,LOW);digitalWrite(LCD_DC,LOW);bytes(&cmd,1);
    digitalWrite(LCD_DC,HIGH);if(size)bytes(data,size);digitalWrite(LCD_CS,HIGH);
  }
  void window(uint16_t x,uint16_t y,uint16_t w,uint16_t h){
    const uint16_t x2=x+w-1,y2=y+h-1;
    uint8_t a[]={uint8_t(x>>8),uint8_t(x),uint8_t(x2>>8),uint8_t(x2)};
    uint8_t b[]={uint8_t(y>>8),uint8_t(y),uint8_t(y2>>8),uint8_t(y2)};
    command(0x2A,a,4);command(0x2B,b,4);command(0x2C);
    digitalWrite(LCD_CS,LOW);digitalWrite(LCD_DC,HIGH);
  }
public:
  bool ready=false;
  bool begin(uint32_t frequency){
    pinMode(LCD_RST,OUTPUT);pinMode(LCD_CS,OUTPUT);pinMode(LCD_DC,OUTPUT);
    digitalWrite(LCD_CS,HIGH);digitalWrite(LCD_RST,HIGH);delay(5);
    digitalWrite(LCD_RST,LOW);delay(20);digitalWrite(LCD_RST,HIGH);delay(150);
    if(!program.prepare(&pio,&sm,&offset,LCD_SCK,1))return false;
    pio_spi_init(pio,sm,offset,8,float(rp2040.f_cpu())/frequency/4.0f,false,false,LCD_SCK,LCD_MOSI,0);
    ready=true;
    const uint8_t* cursor=KANA_LCD_INIT;
    while(*cursor){uint8_t cmd=*cursor++,args=*cursor++;command(cmd,cursor,args&0x7F);cursor+=args&0x7F;if(args&0x80)delay(150);}
    return true;
  }
  void fillScreen(uint16_t color){
    uint8_t row[480];for(unsigned i=0;i<240;++i){row[i*2]=color>>8;row[i*2+1]=color;}
    window(0,0,240,240);for(unsigned y=0;y<240;++y)bytes(row,sizeof(row));digitalWrite(LCD_CS,HIGH);
  }
  void bitmap(uint16_t* pixels,uint16_t size){
    // Prepare the complete image in RAM, then replace the LCD region in one continuous transfer.
    for(unsigned i=0;i<unsigned(size)*size;++i)pixels[i]=__builtin_bswap16(pixels[i]);
    window((240-size)/2,(240-size)/2,size,size);bytes((const uint8_t*)pixels,unsigned(size)*size*2);digitalWrite(LCD_CS,HIGH);
  }
};
KanaLcd display;
