#-------------------------------------------------
#
# Project: BLE Scanner for Raspberry Pi (Yocto)
# Based on Qt Bluetooth with native BLE support
# Created: 2026-01-06
#
#-------------------------------------------------

QT += core gui bluetooth sql

greaterThan(QT_MAJOR_VERSION, 4): QT += widgets

TARGET = ble_scanner
TEMPLATE = app

# Configuración para sistemas embebidos (Yocto/Raspberry Pi)
DEFINES += QT_DEPRECATED_WARNINGS
CONFIG += c++11

# Configuraciones específicas para Yocto/embedded
target.path = /usr/bin/application
INSTALLS += target

# Configuración de debugging
CONFIG(debug, debug|release) {
    DEFINES += DEBUG_BLE=1
} else {
    DEFINES += DEBUG_BLE=0
}

# Fuentes principales
SOURCES += \
        ble_main.cpp \
        ble_gap.cpp

# Headers principales  
HEADERS += \
        ble_gap.h

# Formularios UI (se crearán automáticamente por código)
# FORMS += ble_gap.ui

# Incluir dependencias de MessageBox (del proyecto original)
exists(../messagebox/messagebox.pri) {
    include(../messagebox/messagebox.pri)
} else {
    message("Warning: messagebox.pri not found, creating dummy implementation")
    SOURCES += messagebox_dummy.cpp
    HEADERS += messagebox_dummy.h
}

# Configuración para diferentes plataformas
unix:!macx {
    # Configuración para Linux/Yocto
    QMAKE_CXXFLAGS += -std=c++11
    
    # Rutas específicas para Yocto
    CONFIG += link_pkgconfig
    
    # Optimizaciones para Raspberry Pi
    QMAKE_CXXFLAGS_RELEASE += -O2 -march=native
    
    # Configuración de runtime paths para sistemas embebidos
    QMAKE_RPATHDIR += /usr/lib/qt5
}

# Configuración específica para Raspberry Pi
contains(QMAKE_HOST.arch, arm.*) {
    message("Building for ARM (Raspberry Pi)")
    DEFINES += TARGET_ARM=1
    
    # Optimizaciones específicas para ARM
    QMAKE_CXXFLAGS += -mfpu=vfp -mfloat-abi=hard
}

# Archivos de recursos adicionales
RESOURCES += ble_resources.qrc

# Configuración de instalación
desktop.files = ble_scanner.desktop
desktop.path = /usr/share/applications
INSTALLS += desktop

# Scripts de instalación
scripts.files = install_ble_dependencies.sh
scripts.path = /usr/bin/application/scripts
INSTALLS += scripts

# Configuración de base de datos SQLite
DEFINES += BLE_DB_PATH=\\\"/usr/bin/application/ble/beacons.db\\\"
DEFINES += BLE_LOG_PATH=\\\"/usr/bin/application/ble/ble.log\\\"
DEFINES += BLE_CONFIG_PATH=\\\"/usr/bin/application/ble/ble.config\\\"
DEFINES += BLE_APP_PATH=\\\"/usr/bin/application/ble\\\"

# Configuración específica del proyecto
DEFINES += TARGET_MAC_PREFIX=\\\"BC:57:29\\\"
DEFINES += SCAN_RANGE=80
DEFINES += UNIT_NAME=\\\"QT_BLE_SCANNER\\\"

# Configuración de warnings
QMAKE_CXXFLAGS += -Wall -Wextra

# Configuración de clean
QMAKE_CLEAN += $$TARGET
QMAKE_CLEAN += *.o
QMAKE_CLEAN += moc_*.cpp
QMAKE_CLEAN += ui_*.h

# Configuración de distribución
DISTFILES += \
    README_BLE.md \
    ble_scanner.desktop \
    install_ble_dependencies.sh