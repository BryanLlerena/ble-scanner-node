#include "ble_gap.h"
#include <QDebug>
#include <QFile>
#include <QTextStream>
#include <QDir>
#include <QDateTime>
#include <QThread>
#include <QApplication>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGroupBox>
#include <QSplitter>
#include <QHeaderView>

#define DEBUG_BLE 1

// Configuración de escaneo BLE
#define BLE_SCAN_TIMEOUT 30000  // 30 segundos de escaneo
#define BLE_DISCOVERY_TIMEOUT 5000  // 5 segundos entre discovery cycles
#define BLE_SCAN_INTERVAL 1000  // 1 segundo entre scans

static void bleDebug(const QString &type, const QString &str)
{
#ifdef DEBUG_BLE
    QString timestamp = QDateTime::currentDateTime().toString("hh:mm:ss.zzz");
    QString msg = QString("[%1] %2 --> %3").arg(timestamp, type, str);
    qDebug() << qPrintable(msg);
#endif
}

BLEGap::BLEGap(QWidget *parent) :
    QWidget(parent),
    ui(nullptr),
    discoveryAgent(nullptr),
    localDevice(nullptr),
    isScanning(false),
    bluetoothEnabled(false),
    currentUnit(UNIT_NAME)
{
    setupUI();
    setupDatabase();
    
    // Configuración inicial
    setWindowTitle("BLE Scanner - Raspberry Pi");
    setFixedSize(1280, 770);
    
    // Inicializar Qt Bluetooth
    localDevice = new QBluetoothLocalDevice(this);
    discoveryAgent = new QBluetoothDeviceDiscoveryAgent(this);
    
    // Configurar discovery agent para BLE
    discoveryAgent->setLowEnergyDiscoveryTimeout(BLE_DISCOVERY_TIMEOUT);
    
    // Configurar timers
    scanTimer = new QTimer(this);
    timeoutTimer = new QTimer(this);
    
    // Conectar señales Bluetooth
    connect(localDevice, &QBluetoothLocalDevice::hostModeStateChanged,
            this, &BLEGap::onBluetoothStateChanged);
    
    connect(discoveryAgent, &QBluetoothDeviceDiscoveryAgent::deviceDiscovered,
            this, &BLEGap::onDeviceDiscovered);
    
    connect(discoveryAgent, &QBluetoothDeviceDiscoveryAgent::finished,
            this, &BLEGap::onScanFinished);
    
    connect(discoveryAgent, 
            QOverload<QBluetoothDeviceDiscoveryAgent::Error>::of(&QBluetoothDeviceDiscoveryAgent::error),
            this, &BLEGap::onScanError);
    
    // Conectar timers
    connect(scanTimer, &QTimer::timeout, this, &BLEGap::startBLEScan);
    connect(timeoutTimer, &QTimer::timeout, this, &BLEGap::onScanTimeout);
    
    // Verificar estado inicial de Bluetooth
    if (localDevice->isValid()) {
        bleDebug("INIT", "Bluetooth adapter encontrado");
        if (localDevice->hostMode() != QBluetoothLocalDevice::HostPoweredOff) {
            bluetoothEnabled = true;
            ble_enable();
            check_enable->setChecked(true);
            bleDebug("INIT", "Bluetooth ya está encendido");
        } else {
            ble_disable();
            bleDebug("INIT", "Bluetooth está apagado");
        }
    } else {
        showWarningMessage("No se encontró adaptador Bluetooth");
        bleDebug("ERROR", "No se encontró adaptador Bluetooth");
        ble_disable();
    }
    
    // Crear directorios necesarios
    createBLEDirectories();
    
    // Estado inicial
    updateStatus();
    
    bleDebug("INIT", "BLE Scanner inicializado correctamente");
}

BLEGap::~BLEGap()
{
    if (isScanning) {
        stopBLEScan();
    }
    
    if (scanTimer->isActive()) {
        scanTimer->stop();
    }
    
    if (timeoutTimer->isActive()) {
        timeoutTimer->stop();
    }
    
    if (db.isOpen()) {
        db.close();
    }
    
    bleDebug("CLEANUP", "BLE Scanner cerrado");
}

void BLEGap::setupUI()
{
    // Layout principal
    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    
    // Botón cerrar (como en gap.cpp)
    QPushButton *closeButton = new QPushButton("Exit", this);
    closeButton->setGeometry(1180, 0, 100, 40);
    closeButton->setFont(QFont("Ubuntu", 15));
    closeButton->setStyleSheet("background-color: red;");
    connect(closeButton, &QPushButton::clicked, this, &BLEGap::close);
    
    // Panel de control superior
    QGroupBox *controlGroup = new QGroupBox("Control BLE");
    QHBoxLayout *controlLayout = new QHBoxLayout(controlGroup);
    
    check_enable = new QCheckBox("Habilitar Bluetooth");
    btn_scan = new QPushButton("Escanear");
    btn_clear = new QPushButton("Limpiar");
    label_status = new QLabel("Estado: Desconectado");
    label_count = new QLabel("Dispositivos: 0");
    
    controlLayout->addWidget(check_enable);
    controlLayout->addWidget(btn_scan);
    controlLayout->addWidget(btn_clear);
    controlLayout->addStretch();
    controlLayout->addWidget(label_status);
    controlLayout->addWidget(label_count);
    
    // Panel de dispositivos - SOLO SCANNING
    QSplitter *splitter = new QSplitter(Qt::Horizontal);
    
    // Lista de dispositivos descubiertos (solo lectura)
    QGroupBox *discoveredGroup = new QGroupBox("📡 Dispositivos BLE Descubiertos");
    QVBoxLayout *discoveredLayout = new QVBoxLayout(discoveredGroup);
    listWidget_discovered = new QListWidget();
    listWidget_discovered->verticalScrollBar()->setStyleSheet("QScrollBar{width:20px;}");
    discoveredLayout->addWidget(listWidget_discovered);
    
    // Panel de logs y estado Node.js
    QGroupBox *logsGroup = new QGroupBox("📊 Logs & Estado Node.js");
    QVBoxLayout *logsLayout = new QVBoxLayout(logsGroup);
    
    listWidget_logs = new QListWidget();
    listWidget_logs->verticalScrollBar()->setStyleSheet("QScrollBar{width:20px;}");
    logsLayout->addWidget(listWidget_logs);
    
    // Botones para Node.js
    QHBoxLayout *nodeButtonsLayout = new QHBoxLayout();
    btn_view_web = new QPushButton("🌐 Abrir Web Viewer");
    nodeButtonsLayout->addWidget(btn_view_web);
    nodeButtonsLayout->addStretch();
    label_node_status = new QLabel("Node.js: Verificando...");
    nodeButtonsLayout->addWidget(label_node_status);
    logsLayout->addLayout(nodeButtonsLayout);
    
    splitter->addWidget(discoveredGroup);
    splitter->addWidget(logsGroup);
    splitter->setSizes({600, 680});
    
    // Agregar todo al layout principal
    mainLayout->addWidget(controlGroup);
    mainLayout->addWidget(splitter);
    
    // Conectar señales de botones - SOLO SCANNING
    connect(check_enable, &QCheckBox::clicked, this, &BLEGap::on_enable_check_clicked);
    connect(btn_scan, &QPushButton::clicked, this, &BLEGap::on_scan_clicked);
    connect(btn_clear, &QPushButton::clicked, this, &BLEGap::on_clear_clicked);
    connect(btn_view_web, &QPushButton::clicked, this, &BLEGap::on_view_web_clicked);
    
    // Timer para verificar servicios Node.js
    QTimer *nodeCheckTimer = new QTimer(this);
    connect(nodeCheckTimer, &QTimer::timeout, this, &BLEGap::checkNodeServices);
    nodeCheckTimer->start(5000);  // Verificar cada 5 segundos
    
    // Estado inicial de botones
    ble_disable();
}

void BLEGap::setupDatabase()
{
    // Configurar base de datos SQLite - MISMA QUE NODE.JS
    db = QSqlDatabase::addDatabase("QSQLITE");
    db.setDatabaseName(BLE_DB_PATH);  // "beacons.db" en directorio actual
    
    if (!db.open()) {
        bleDebug("ERROR", "No se pudo abrir la base de datos: " + db.lastError().text());
        showWarningMessage("Error abriendo base de datos: " + db.lastError().text());
        
        // Intentar en directorio actual como fallback
        db.setDatabaseName("./beacons.db");
        if (!db.open()) {
            showWarningMessage("No se pudo conectar con la base de datos de Node.js");
            return;
        }
    }
    
    bleDebug("DB", "Conectado a base de datos Node.js: " + db.databaseName());
    
    // Verificar que la tabla existe (creada por Node.js)
    QSqlQuery checkQuery("SELECT name FROM sqlite_master WHERE type='table' AND name='beacon_events'");
    if (!checkQuery.exec() || !checkQuery.next()) {
        bleDebug("WARNING", "Tabla beacon_events no encontrada - ¿Node.js corriendo?");
        
        // Crear tabla compatible con Node.js si no existe
        QString createTable = R"(
            CREATE TABLE IF NOT EXISTS beacon_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                deviceId TEXT,
                beaconMac TEXT,
                name TEXT,
                rssi TEXT,
                rssi_discard TEXT,
                timestamp TEXT,
                type TEXT,
                uuid TEXT,
                major INTEGER,
                minor INTEGER,
                txPower INTEGER,
                namespace TEXT,
                instance TEXT,
                distance REAL,
                distanceInM REAL,
                eventState TEXT DEFAULT 'open',
                f_inicio TEXT,
                f_final TEXT,
                unit TEXT,
                manufacturerData TEXT,
                serviceData TEXT,
                syncStatus TEXT DEFAULT 'pending',
                syncTimestamp DATETIME
            )
        )";
        
        QSqlQuery query;
        if (!query.exec(createTable)) {
            bleDebug("ERROR", "Error creando tabla: " + query.lastError().text());
        } else {
            bleDebug("DB", "Tabla beacon_events creada (compatible con Node.js)");
        }
    } else {
        bleDebug("DB", "Tabla beacon_events encontrada - Node.js compatible");
    }
}

void BLEGap::ble_enable()
{
    btn_scan->setEnabled(true);
    btn_connect->setEnabled(true);
    btn_disconnect->setEnabled(true);
    btn_clear->setEnabled(true);
    
    setButtonColor(btn_scan, Qt::green);
    setButtonColor(btn_connect, Qt::green);
    setButtonColor(btn_disconnect, Qt::green);
    setButtonColor(btn_clear, Qt::green);
    
    label_status->setText("Estado: Bluetooth Habilitado");
    bluetoothEnabled = true;
    
    bleDebug("BLE", "Bluetooth habilitado - controles activos");
}

void BLEGap::ble_disable()
{
    btn_scan->setEnabled(false);
    btn_connect->setEnabled(false);
    btn_disconnect->setEnabled(false);
    btn_clear->setEnabled(false);
    
    setButtonColor(btn_scan, Qt::gray);
    setButtonColor(btn_connect, Qt::gray);
    setButtonColor(btn_disconnect, Qt::gray);
    setButtonColor(btn_clear, Qt::gray);
    
    label_status->setText("Estado: Bluetooth Deshabilitado");
    bluetoothEnabled = false;
    
    if (isScanning) {
        stopBLEScan();
    }
    
    bleDebug("BLE", "Bluetooth deshabilitado - controles inactivos");
}

void BLEGap::setButtonColor(QPushButton *button, const QColor &color)
{
    QPalette palette = button->palette();
    palette.setColor(QPalette::Button, color);
    button->setPalette(palette);
}

void BLEGap::onDeviceDiscovered(const QBluetoothDeviceInfo &device)
{
    QString address = device.address().toString().toLower();
    QString deviceName = device.name().isEmpty() ? "Sin nombre" : device.name();
    int rssi = device.rssi();
    
    // Solo procesar dispositivos objetivo
    if (!isTargetDevice(address)) {
        return;
    }
    
    // Evitar duplicados en la UI
    if (detectedDevices.contains(address)) {
        // Actualizar RSSI si ya existe
        for (int i = 0; i < listWidget_discovered->count(); ++i) {
            QListWidgetItem *item = listWidget_discovered->item(i);
            if (item->data(Qt::UserRole).toString() == address) {
                QString displayText = QString("%1\n%2 | RSSI: %3 dBm | Dist: %4m")
                    .arg(deviceName)
                    .arg(address.toUpper())
                    .arg(rssi)
                    .arg(calculateDistance(rssi), 0, 'f', 1);
                item->setText(displayText);
                break;
            }
        }
    } else {
        // Agregar nuevo dispositivo
        detectedDevices.insert(address);
        
        QString displayText = QString("%1\n%2 | RSSI: %3 dBm | Dist: %4m")
            .arg(deviceName)
            .arg(address.toUpper())
            .arg(rssi)
            .arg(calculateDistance(rssi), 0, 'f', 1);
        
        QListWidgetItem *item = new QListWidgetItem(displayText);
        item->setData(Qt::UserRole, address);  // Guardar MAC en UserRole
        listWidget_discovered->addItem(item);
        
        bleDebug("DISCOVER", QString("Nuevo beacon: %1 | RSSI: %2").arg(address.toUpper()).arg(rssi));
    }
    
    // Guardar en base de datos
    saveBeaconToDatabase(device);
    
    // Actualizar contador
    updateStatus();
}

void BLEGap::saveBeaconToDatabase(const QBluetoothDeviceInfo &device)
{
    QString address = device.address().toString().toLower();
    QString deviceName = device.name().isEmpty() ? "BLE_Device" : device.name();
    int rssi = device.rssi();
    double distanceInM = calculateDistance(rssi);
    QString timestamp = QDateTime::currentDateTime().toString(Qt::ISODate);
    
    // Crear JSON para RSSI (compatible con tu formato Node.js)
    QString rssiJson = QString(R"([{"rssi": %1, "datetime": %2, "distance": %3}])")
        .arg(rssi)
        .arg(QDateTime::currentMSecsSinceEpoch())
        .arg(distanceInM);
    
    QSqlQuery query;
    query.prepare(R"(
        INSERT INTO beacon_events 
        (deviceId, beaconMac, name, rssi, rssi_discard, timestamp, type, uuid, 
         distance, distanceInM, eventState, f_inicio, f_final, unit, syncStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 'pending')
    )");
    
    query.addBindValue(address);
    query.addBindValue(address);
    query.addBindValue(deviceName);
    query.addBindValue(distanceInM <= SCAN_RANGE ? rssiJson : "[]");
    query.addBindValue(distanceInM > SCAN_RANGE ? rssiJson : "[]");
    query.addBindValue(timestamp);
    query.addBindValue("BLE");
    query.addBindValue(QString("ble-%1").arg(address));
    query.addBindValue(distanceInM * 100);  // distance en cm
    query.addBindValue(distanceInM);
    query.addBindValue(timestamp);  // f_inicio
    query.addBindValue(timestamp);  // f_final
    query.addBindValue(currentUnit);
    
    if (!query.exec()) {
        bleDebug("DB_ERROR", "Error guardando beacon: " + query.lastError().text());
    } else {
        bleDebug("DB", QString("Beacon guardado: %1").arg(address));
    }
}

double BLEGap::calculateDistance(int rssi, int txPower)
{
    if (rssi == 0) return -1.0;
    
    double n = 2.0;  // Factor de pérdida de ruta
    return qPow(10.0, (txPower - rssi) / (10.0 * n));
}

bool BLEGap::isTargetDevice(const QString &address)
{
    return address.startsWith(TARGET_MAC_PREFIX, Qt::CaseInsensitive);
}

void BLEGap::startBLEScan()
{
    if (!bluetoothEnabled || !localDevice || !localDevice->isValid()) {
        showWarningMessage("Bluetooth no está disponible");
        return;
    }
    
    if (isScanning) {
        bleDebug("SCAN", "Escaneo ya está en progreso");
        return;
    }
    
    bleDebug("SCAN", "Iniciando escaneo BLE...");
    
    // Configurar para buscar solo dispositivos BLE
    discoveryAgent->start(QBluetoothDeviceDiscoveryAgent::LowEnergyMethod);
    
    isScanning = true;
    btn_scan->setText("Detener");
    setButtonColor(btn_scan, Qt::red);
    label_status->setText("Estado: Escaneando...");
    
    // Configurar timeout
    timeoutTimer->start(BLE_SCAN_TIMEOUT);
    
    bleDebug("SCAN", "Escaneo BLE iniciado");
}

void BLEGap::stopBLEScan()
{
    if (!isScanning) {
        return;
    }
    
    discoveryAgent->stop();
    timeoutTimer->stop();
    
    isScanning = false;
    btn_scan->setText("Escanear");
    setButtonColor(btn_scan, Qt::green);
    label_status->setText("Estado: Bluetooth Habilitado");
    
    bleDebug("SCAN", "Escaneo BLE detenido");
}

void BLEGap::onScanFinished()
{
    bleDebug("SCAN", "Ciclo de escaneo completado");
    
    if (isScanning) {
        // Reiniciar escaneo automáticamente (como hace tu bluetoothctl)
        QTimer::singleShot(1000, this, &BLEGap::startBLEScan);
    }
}

void BLEGap::onScanError(QBluetoothDeviceDiscoveryAgent::Error error)
{
    QString errorStr = "";
    switch (error) {
        case QBluetoothDeviceDiscoveryAgent::PoweredOffError:
            errorStr = "Bluetooth está apagado";
            break;
        case QBluetoothDeviceDiscoveryAgent::InputOutputError:
            errorStr = "Error de entrada/salida";
            break;
        case QBluetoothDeviceDiscoveryAgent::InvalidBluetoothAdapterError:
            errorStr = "Adaptador Bluetooth inválido";
            break;
        case QBluetoothDeviceDiscoveryAgent::UnsupportedPlatformError:
            errorStr = "Plataforma no soportada";
            break;
        case QBluetoothDeviceDiscoveryAgent::UnsupportedDiscoveryMethod:
            errorStr = "Método de descubrimiento no soportado";
            break;
        default:
            errorStr = "Error desconocido";
    }
    
    bleDebug("ERROR", "Error de escaneo: " + errorStr);
    showWarningMessage("Error de escaneo: " + errorStr);
    
    if (isScanning) {
        stopBLEScan();
    }
    
    // Intentar reiniciar en 5 segundos
    QTimer::singleShot(5000, [this]() {
        if (bluetoothEnabled && !isScanning) {
            bleDebug("RETRY", "Reintentando escaneo después de error");
            startBLEScan();
        }
    });
}

void BLEGap::onBluetoothStateChanged(QBluetoothLocalDevice::HostMode mode)
{
    switch (mode) {
        case QBluetoothLocalDevice::HostPoweredOff:
            bleDebug("BT_STATE", "Bluetooth apagado");
            ble_disable();
            check_enable->setChecked(false);
            break;
        case QBluetoothLocalDevice::HostConnectable:
        case QBluetoothLocalDevice::HostDiscoverable:
            bleDebug("BT_STATE", "Bluetooth encendido");
            ble_enable();
            check_enable->setChecked(true);
            break;
    }
    updateStatus();
}

void BLEGap::on_enable_check_clicked(bool checked)
{
    if (!localDevice || !localDevice->isValid()) {
        showWarningMessage("No se encontró adaptador Bluetooth");
        check_enable->setChecked(false);
        return;
    }
    
    if (checked) {
        bleDebug("ENABLE", "Encendiendo Bluetooth...");
        localDevice->powerOn();
        // El estado se actualizará por la señal hostModeStateChanged
    } else {
        bleDebug("DISABLE", "Apagando Bluetooth...");
        if (isScanning) {
            stopBLEScan();
        }
        localDevice->setHostMode(QBluetoothLocalDevice::HostPoweredOff);
    }
}

void BLEGap::on_scan_clicked()
{
    if (!bluetoothEnabled) {
        showWarningMessage("Primero habilita el Bluetooth");
        return;
    }
    
    if (isScanning) {
        stopBLEScan();
    } else {
        startBLEScan();
    }
}

void BLEGap::on_view_web_clicked()
{
    bleDebug("WEB", "Abriendo web viewer Node.js...");
    
    // Intentar abrir en navegador por defecto
    QString url = "http://localhost:3000";
    QProcess::startDetached("xdg-open", QStringList() << url);
    
    // También log en la UI
    QString msg = QString("🌐 Web Viewer: %1").arg(url);
    listWidget_logs->addItem(msg);
    listWidget_logs->scrollToBottom();
    
    showInformationMessage("Abriendo Web Viewer en: " + url);
}

void BLEGap::checkNodeServices()
{
    // Verificar si servicios Node.js están corriendo
    QProcess checkWeb;
    checkWeb.start("curl", QStringList() << "-s" << "-o" << "/dev/null" << "-w" << "%{http_code}" << "http://localhost:3000");
    checkWeb.waitForFinished(2000);
    
    QString webStatus = "❌ Offline";
    if (checkWeb.exitCode() == 0) {
        QString output = checkWeb.readAllStandardOutput().trimmed();
        if (output == "200") {
            webStatus = "✅ Online";
        }
    }
    
    // Verificar sync-processor (buscar proceso)
    QProcess checkSync;
    checkSync.start("pgrep", QStringList() << "-f" << "sync-processor");
    checkSync.waitForFinished(1000);
    
    QString syncStatus = checkSync.exitCode() == 0 ? "✅ Running" : "❌ Stopped";
    
    // Actualizar estado en UI
    label_node_status->setText(QString("Node.js - Web: %1 | Sync: %2").arg(webStatus, syncStatus));
    
    // Log ocasional del estado
    static int statusLogCount = 0;
    if (statusLogCount % 12 == 0) {  // Cada minuto (5s * 12)
        QString logMsg = QString("📊 Estado Node.js: Web=%1, Sync=%2").arg(webStatus, syncStatus);
        listWidget_logs->addItem(logMsg);
        if (listWidget_logs->count() > 100) {
            delete listWidget_logs->takeItem(0);  // Mantener solo últimos 100
        }
        listWidget_logs->scrollToBottom();
    }
    statusLogCount++;
}

void BLEGap::on_clear_clicked()
{
    listWidget_discovered->clear();
    detectedDevices.clear();
    
    bleDebug("CLEAR", "Lista de dispositivos limpiada");
    updateStatus();
}

void BLEGap::on_close_clicked()
{
    this->close();
}

void BLEGap::onScanTimeout()
{
    bleDebug("TIMEOUT", "Timeout de escaneo alcanzado");
    if (isScanning) {
        stopBLEScan();
        // Reiniciar escaneo después de una pausa
        QTimer::singleShot(2000, this, &BLEGap::startBLEScan);
    }
}

void BLEGap::updateStatus()
{
    int discoveredCount = listWidget_discovered->count();
    
    // Contar registros en DB (por Node.js y Qt)
    QSqlQuery countQuery("SELECT COUNT(*) FROM beacon_events WHERE DATE(timestamp) = DATE('now')");
    int dbCount = 0;
    if (countQuery.exec() && countQuery.next()) {
        dbCount = countQuery.value(0).toInt();
    }
    
    label_count->setText(QString("📡 Descubiertos hoy: %1 | 💾 DB total hoy: %2")
                        .arg(discoveredCount)
                        .arg(dbCount));
}

void BLEGap::refreshDeviceList()
{
    // Función para refrescar lista - útil para llamadas externas
    if (bluetoothEnabled && !isScanning) {
        startBLEScan();
    }
}

// Funciones globales de utilidad
bool createBLEDirectories()
{
    QDir dir;
    if (!dir.exists(BLE_APP_PATH)) {
        if (!dir.mkpath(BLE_APP_PATH)) {
            bleDebug("ERROR", "No se pudo crear directorio: " + QString(BLE_APP_PATH));
            return false;
        }
    }
    return true;
}

void writeBLELog(const QString &message)
{
    QFile file(BLE_LOG_PATH);
    if (file.open(QIODevice::WriteOnly | QIODevice::Append | QIODevice::Text)) {
        QTextStream out(&file);
        out << QDateTime::currentDateTime().toString("yyyy-MM-dd hh:mm:ss") 
            << " - " << message << "\n";
        file.close();
    }
}

QString readBLEConfig(const QString &key)
{
    QFile file(BLE_CONFIG_PATH);
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        return QString();
    }
    
    QTextStream in(&file);
    while (!in.atEnd()) {
        QString line = in.readLine();
        if (line.startsWith(key + "=")) {
            return line.split("=", QString::SkipEmptyParts).value(1);
        }
    }
    
    return QString();
}

void writeBLEConfig(const QString &key, const QString &value)
{
    // Leer configuración actual
    QStringList config;
    QFile file(BLE_CONFIG_PATH);
    
    if (file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        QTextStream in(&file);
        while (!in.atEnd()) {
            QString line = in.readLine();
            if (!line.startsWith(key + "=")) {
                config << line;
            }
        }
        file.close();
    }
    
    // Agregar nueva clave=valor
    config << (key + "=" + value);
    
    // Escribir configuración actualizada
    if (file.open(QIODevice::WriteOnly | QIODevice::Text)) {
        QTextStream out(&file);
        for (const QString &line : config) {
            out << line << "\n";
        }
        file.close();
    }
}