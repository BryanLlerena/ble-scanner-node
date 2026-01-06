#ifndef BLE_GAP_H
#define BLE_GAP_H

#include <QWidget>
#include <QTimer>
#include <QProcess>
#include <QString>
#include <QPushButton>
#include <QScrollBar>
#include <QListWidget>
#include <QCheckBox>
#include <QLabel>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGroupBox>

// Qt Bluetooth para BLE
#include <QBluetoothDeviceDiscoveryAgent>
#include <QBluetoothLocalDevice>
#include <QBluetoothDeviceInfo>
#include <QLowEnergyController>
#include <QLowEnergyService>

// Base de datos SQLite
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QSqlError>

#include "../messagebox/messagebox.h"

// Configuración del sistema BLE - USAR MISMA DB QUE NODE.JS
#define BLE_DB_PATH "beacons.db"  // Misma DB que Node.js en directorio actual
#define BLE_LOG_PATH "logs/ble_scanner.log"
#define BLE_CONFIG_PATH "ble_config.txt"
#define BLE_APP_PATH "."

// Configuración de escaneo
#define TARGET_MAC_PREFIX "BC:57:29"  // Prefijo objetivo de tu sistema
#define SCAN_RANGE 80                 // Rango en metros
#define UNIT_NAME "QT_BLE_SCANNER"    // Identificador de unidad

namespace Ui {
class BLEGap;
}

class BLEGap : public QWidget
{
    Q_OBJECT

public:
    explicit BLEGap(QWidget *parent = 0);
    ~BLEGap();
    Ui::BLEGap *ui;

private:
    // Componentes Qt Bluetooth BLE
    QBluetoothDeviceDiscoveryAgent *discoveryAgent;
    QBluetoothLocalDevice *localDevice;
    QTimer *scanTimer;
    QTimer *timeoutTimer;
    
    // Base de datos SQLite
    QSqlDatabase db;
    
    // Variables de control
    bool isScanning;
    bool bluetoothEnabled;
    QSet<QString> detectedDevices;  // Cache de MACs detectadas
    QString currentUnit;
    
    // UI Components - SOLO SCANNING (sin conectar/desconectar)
    QListWidget *listWidget_discovered;
    QListWidget *listWidget_logs;  // Logs en tiempo real
    QPushButton *btn_scan;
    QPushButton *btn_clear;
    QPushButton *btn_view_web;  // Abrir web-viewer Node.js
    QCheckBox *check_enable;
    QLabel *label_status;
    QLabel *label_count;
    QLabel *label_node_status;  // Estado servicios Node.js
    
    // Funciones privadas
    void setupUI();
    void setupDatabase();
    void setButtonColor(QPushButton *button, const QColor &color);
    void ble_enable();
    void ble_disable();
    void logMessage(const QString &message);
    void saveBeaconToDatabase(const QBluetoothDeviceInfo &device);
    double calculateDistance(int rssi, int txPower = -59);
    bool isTargetDevice(const QString &address);
    
    // Funciones de mensajes (igual que gap.h)
    void showWarningMessage(const QString &msg){
        MessageBox* pMsgBox = new MessageBox(this, SA_OKS, SA_WARNING);
        pMsgBox->setAttribute(Qt::WA_ShowModal, true);
        pMsgBox->setWindowFlags( Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint | Qt::Dialog);
        pMsgBox->SetTips(msg);
        pMsgBox->show();
    }
    
    void showInformationMessage(const QString &msg){
        MessageBox* pMsgBox = new MessageBox(this, SA_OKS, SA_TIPS);
        pMsgBox->setAttribute(Qt::WA_ShowModal, true);
        pMsgBox->setWindowFlags( Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint | Qt::Dialog);
        pMsgBox->SetTips(msg);
        pMsgBox->show();
    }
    
    void showSuccessMessage(const QString &msg){
        MessageBox* pMsgBox = new MessageBox(this, SA_OKS, SA_SUCCESS);
        pMsgBox->setAttribute(Qt::WA_ShowModal, true);
        pMsgBox->setWindowFlags( Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint | Qt::Dialog);
        pMsgBox->SetTips(msg);
        pMsgBox->show();
    }

private slots:
    // Slots de Qt Bluetooth
    void onDeviceDiscovered(const QBluetoothDeviceInfo &device);
    void onScanFinished();
    void onScanError(QBluetoothDeviceDiscoveryAgent::Error error);
    void onBluetoothStateChanged(QBluetoothLocalDevice::HostMode mode);
    
    // Slots de UI - SOLO SCANNING
    void on_scan_clicked();
    void on_clear_clicked();
    void on_view_web_clicked();  // Abrir web-viewer Node.js
    void on_enable_check_clicked(bool checked);
    void on_close_clicked();
    
    // Slots de timers y monitoreo
    void onScanTimeout();
    void updateStatus();
    void checkNodeServices();  // Verificar servicios Node.js

public slots:
    // Funciones públicas (compatibilidad con código existente)
    void startBLEScan();
    void stopBLEScan();
    void refreshDeviceList();

signals:
    // Señales para comunicación con otras ventanas
    void bleDeviceDetected(QString deviceInfo);
    void bleScanStatusChanged(bool scanning);
    void bleErrorOccurred(QString error);
};

// Funciones globales de utilidad BLE
bool createBLEDirectories();
void writeBLELog(const QString &message);
QString readBLEConfig(const QString &key);
void writeBLEConfig(const QString &key, const QString &value);

#endif // BLE_GAP_H