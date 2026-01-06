#!/bin/bash
# Sistema híbrido: Qt BLE Scanner + Node.js Services
# Qt se encarga del scanning, Node.js del resto

echo "🚀 Iniciando sistema híbrido BLE..."

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo "❌ Error: Ejecutar desde directorio ble-scanner-node"
    exit 1
fi

# 1. Parar cualquier scanner Node.js previo
echo "🔄 Deteniendo scanner Node.js anterior..."
pkill -f "node index.js" 2>/dev/null || echo "   (No había scanner Node.js corriendo)"

# 2. Compilar Qt Scanner si no existe
if [ ! -f "bluetooth/ble_scanner" ]; then
    echo "🔨 Compilando Qt BLE Scanner..."
    cd bluetooth
    qmake BLE_Scanner.pro
    make
    cd ..
    
    if [ ! -f "bluetooth/ble_scanner" ]; then
        echo "❌ Error: No se pudo compilar Qt Scanner"
        exit 1
    fi
fi

# 3. Iniciar Qt BLE Scanner  
echo "📡 Iniciando Qt BLE Scanner..."
cd bluetooth
./ble_scanner &
QT_SCANNER_PID=$!
cd ..

sleep 2

if kill -0 $QT_SCANNER_PID 2>/dev/null; then
    echo "✅ Qt Scanner iniciado con PID: $QT_SCANNER_PID"
else
    echo "❌ Error: Qt Scanner no se pudo iniciar"
    exit 1
fi

# 4. Iniciar servicios Node.js híbridos
echo "🌐 Iniciando servicios Node.js..."

# Servicios híbridos (sin scanning)
node index.js &
HYBRID_PID=$!

# Web viewer (puerto 3000)
node web-viewer.js &
WEB_PID=$!

# MQTT sync (si existe)
if [ -f "sync-mqtt.js" ]; then
    node sync-mqtt.js &
    MQTT_PID=$!
else
    MQTT_PID="N/A"
fi

# Sync processor
if [ -f "sync-processor.js" ]; then
    node sync-processor.js &
    SYNC_PID=$!
else
    SYNC_PID="N/A"
fi

sleep 3

echo ""
echo "✅ Sistema híbrido iniciado correctamente:"
echo "   📡 Qt BLE Scanner: PID $QT_SCANNER_PID (scanning BLE)"
echo "   🔄 Node.js Hybrid:  PID $HYBRID_PID (timeouts, stats)"
echo "   🌐 Web Viewer:      PID $WEB_PID (http://localhost:3000)"
echo "   📤 MQTT Sync:       PID $MQTT_PID"
echo "   ⚙️  Sync Processor: PID $SYNC_PID"
echo ""
echo "📊 Funciones:"
echo "   - Qt Scanner: Detecta beacons y escribe a beacons.db"
echo "   - Node.js: Timeouts, web UI, MQTT, estadísticas"
echo "   - Base de datos: beacons.db (compartida)"
echo ""
echo "🌐 Web interface: http://localhost:3000"
echo "🛑 Para detener: ./stop_hybrid.sh"

# Guardar PIDs para limpieza
echo "$QT_SCANNER_PID $HYBRID_PID $WEB_PID $MQTT_PID $SYNC_PID" > /tmp/ble_hybrid.pids