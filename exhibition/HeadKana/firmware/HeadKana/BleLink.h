#pragma once
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <atomic>

constexpr const char* BLE_SERVICE = "9f6c0001-4b68-4b3a-9c87-df6f1da60001";
constexpr const char* BLE_NOTIFY = "9f6c0002-4b68-4b3a-9c87-df6f1da60001";
constexpr const char* BLE_SNAPSHOT = "9f6c0003-4b68-4b3a-9c87-df6f1da60001";
constexpr const char* BLE_SELECTION = "9f6c0004-4b68-4b3a-9c87-df6f1da60001";
std::atomic<bool> bleConnected{false};
std::atomic<uint8_t> bleSelectedKana{23};
BLECharacteristic *bleNotify = nullptr, *bleSnapshot = nullptr, *bleSelection = nullptr;
BLE2902* bleSubscription = nullptr;
bool bleEnabled = false;
class KanaBleCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected.store(true); }
  void onDisconnect(BLEServer*) override { bleConnected.store(false); }
};
class KanaSelectionCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    const String value = characteristic->getValue();
    if (value.length() == 1 && uint8_t(value[0]) < 46) {
      bleSelectedKana.store(uint8_t(value[0]));
    }
  }
};
uint8_t selectedKanaIndex() { return bleSelectedKana.load(); }
void startBLE() {
  if (!BLEDevice::init("M5-Kana")) { Serial.println("ERROR BLE initialization"); return; }
  auto server = BLEDevice::createServer();
  server->setCallbacks(new KanaBleCallbacks());
  server->advertiseOnDisconnect(true);
  auto service = server->createService(BLE_SERVICE);
  bleNotify = service->createCharacteristic(BLE_NOTIFY, BLECharacteristic::PROPERTY_NOTIFY);
  bleSubscription = new BLE2902();
  bleNotify->addDescriptor(bleSubscription);
  bleSnapshot = service->createCharacteristic(BLE_SNAPSHOT, BLECharacteristic::PROPERTY_READ);
  bleSnapshot->setValue("{\"type\":\"sensor\",\"protocol\":2,\"ready\":false}");
  bleSelection = service->createCharacteristic(
    BLE_SELECTION,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  uint8_t initialSelection = bleSelectedKana.load();
  bleSelection->setValue(&initialSelection, 1);
  bleSelection->setCallbacks(new KanaSelectionCallbacks());
  service->start();
  auto adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06); adv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
  bleEnabled = true;
  Serial.println("BLE advertising M5-Kana protocol=2 selection-display");
}
void notifySensor(uint8_t* packet, size_t size) {
  if (!bleEnabled || !bleConnected.load() || !bleSubscription->getNotifications()) return;
  bleNotify->setValue(packet, size);
  bleNotify->notify();
}
