#include "ble_gap.h"
#include <QApplication>
#include <QStyleFactory>
#include <QDir>
#include <QDebug>

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    
    // Configuración de la aplicación
    app.setApplicationName("BLE Scanner");
    app.setApplicationVersion("1.0.0");
    app.setOrganizationName("Raspberry Pi BLE");
    app.setOrganizationDomain("raspberrypi.ble");
    
    // Configurar estilo para sistemas embebidos
    app.setStyle(QStyleFactory::create("Fusion"));
    
    // Verificar que los directorios necesarios existan
    if (!createBLEDirectories()) {
        qWarning() << "Warning: Could not create BLE directories";
    }
    
    // Crear y mostrar la ventana principal
    BLEGap scanner;
    scanner.show();
    
    qDebug() << "BLE Scanner iniciado exitosamente";
    qDebug() << "Objetivo: dispositivos con prefijo" << TARGET_MAC_PREFIX;
    qDebug() << "Rango de escaneo:" << SCAN_RANGE << "metros";
    qDebug() << "Base de datos:" << BLE_DB_PATH;
    
    return app.exec();
}