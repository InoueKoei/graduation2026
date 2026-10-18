#include "ATOM_PRINTER.h"
#include "ATOM_PRINTER_CMD.h"

void ATOM_PRINTER::begin(HardwareSerial *serial, int baud, uint8_t RX, uint8_t TX, bool debug)
{
    _debug  = debug;
    _serial = serial;
    _serial->begin(baud, SERIAL_8N1, RX, TX);
}

void ATOM_PRINTER::init()
{
    _serial->write(INIT_PRINTER_CMD, sizeof(INIT_PRINTER_CMD));
}

void ATOM_PRINTER::WriteCMD(uint8_t *buff, uint8_t buff_size)
{
    cleanBuffer();
    // memcpy(buffer, PRINT_POS_CMD, sizeof(PRINT_POS_CMD));
    memcpy(buffer, buff, buff_size);
    _serial->write(buffer, buff_size);
}

void ATOM_PRINTER::printPos(uint16_t posx)
{
    cleanBuffer();
    memcpy(buffer, PRINT_POS_CMD, sizeof(PRINT_POS_CMD));
    buffer[2] = posx & 0xff;
    buffer[3] = (posx >> 8) & 0xff;
    _serial->write(buffer, 4);
}

void ATOM_PRINTER::fontSize(uint8_t font_size)
{
    cleanBuffer();
    if (font_size > 7) font_size = 7;
    memcpy(buffer, FONT_SIZE_CMD, sizeof(FONT_SIZE_CMD));
    buffer[2] = (font_size | (font_size << 4)) & 0xff;
    _serial->write(buffer, 3);
}

void ATOM_PRINTER::cleanBuffer()
{
    for (int i = 0; i < 256; i++) {
        buffer[i] = 0;
    }
}

void ATOM_PRINTER::newLine(uint8_t count)
{
    for (uint8_t i = 0; i < count; i++) {
        _serial->write(0x0A);
    }
}

void ATOM_PRINTER::printASCII(String data)
{
    _serial->print(data);
}

void ATOM_PRINTER::printQRCode(String qrcode)
{
    // set qrcode
    uint8_t len, nH, nL;
    len = qrcode.length();
    len += 3;
    nL = len & 0x00ff;
    nH = (len >> 8) & 0x00ff;
    cleanBuffer();
    memcpy(buffer, SET_QRCODE_CMD, sizeof(SET_QRCODE_CMD));
    buffer[3] = nL;
    buffer[4] = nH;
    _serial->write(buffer, sizeof(SET_QRCODE_CMD));
    _serial->print(qrcode);
    _serial->write(0x00);
    // print qrcode
    cleanBuffer();
    memcpy(buffer, PRINTER_QRCODE_CMD, sizeof(PRINTER_QRCODE_CMD));
    _serial->write(buffer, sizeof(PRINTER_QRCODE_CMD));
}

void ATOM_PRINTER::setBarCodeHRI(BarCodePos_t pos)
{
    _serial->write(SET_BAR_CODE_POS_CMD, sizeof(SET_BAR_CODE_POS_CMD));
    _serial->write(pos);
}
void ATOM_PRINTER::setQRCodeECL(QRCode_EC_Level_t level)
{
    _serial->write(SET_QRCODE_ECL_CODE_CMD, sizeof(SET_QRCODE_ECL_CODE_CMD));
    _serial->write(level);
}

void ATOM_PRINTER::enableBarCode(bool state)
{
    cleanBuffer();
    memcpy(buffer, ENABLE_BAR_CODE_MODE_CMD, sizeof(ENABLE_BAR_CODE_MODE_CMD));
    buffer[3] = state;
    _serial->write(buffer, sizeof(ENABLE_BAR_CODE_MODE_CMD));
}

void ATOM_PRINTER::printBarCode(BarCode_t type, String barcode)
{
    enableBarCode(1);
    cleanBuffer();
    memcpy(buffer, PRINTER_BAR_CODE_CMD, sizeof(PRINTER_BAR_CODE_CMD));
    uint8_t len = barcode.length();
    buffer[2]   = type;
    buffer[3]   = len;
    _serial->write(buffer, sizeof(PRINTER_BAR_CODE_CMD));
    _serial->print(barcode);
    _serial->write(0x00);
    enableBarCode(0);
}

// 改変：元は命令ヘッダを画像データの先頭8バイトに上書きしていたので、
// 左上の64ドットが化けていた。ヘッダは別の配列で組む。
// また、384x223（約10KB）を1回の GS v 0 で送るとプリンタが途中で画像モードを抜け、
// 残りを GBK の文字として刷った（4KB の公式サンプルは通る）。BMP_BAND_ROWS 行ずつの帯に分けて送る。
#define BMP_BAND_ROWS 24

void ATOM_PRINTER::printBMP(uint8_t mode, uint16_t xdot, uint16_t ydot, uint8_t *data)
{
    if (mode > 3) mode = 3;
    uint16_t xbytes = xdot / 8;
    for (uint16_t y = 0; y < ydot; y += BMP_BAND_ROWS) {
        uint16_t rows = min((uint16_t)BMP_BAND_ROWS, (uint16_t)(ydot - y));
        uint8_t header[sizeof(PRINTER_BMP_CMD)];
        memcpy(header, PRINTER_BMP_CMD, sizeof(PRINTER_BMP_CMD));
        header[3] = mode;
        header[4] = (uint8_t)(xbytes & 0x00ff);
        header[5] = (uint8_t)((xbytes >> 8) & 0x00ff);
        header[6] = (uint8_t)(rows & 0x00ff);
        header[7] = (uint8_t)((rows >> 8) & 0x00ff);
        _serial->write(header, sizeof(header));
        _serial->write(data + (size_t)xbytes * y, (size_t)xbytes * rows);
    }
}
