# BLE Scanner para Raspberry Pi

## Descripción
Scanner BLE nativo desarrollado en Qt/C++ como alternativa robusta a bluetoothctl para sistemas Yocto/Raspberry Pi.

## Características

### ✅ **Ventajas sobre bluetoothctl:**
- **Sin subprocesos externos** - APIs nativas Qt Bluetooth
- **Sin parsing de texto** - Eventos directos del sistema
- **Sin reinicios constantes** - Manejo automático de reconexiones
- **Interfaz gráfica** - UI similar al proyecto bluetooth original
- **Base de datos integrada** - Compatible con esquema Node.js existente
- **Estable en Yocto** - Optimizado para sistemas embebidos

### 🎯 **Funcionalidades:**
- Escaneo BLE continuo con filtros por prefijo MAC
- Cálculo de distancia basado en RSSI
- Guardado automático en SQLite (compatible con tu formato)
- UI gráfica con listas de dispositivos descubiertos/conectados
- Logs detallados para debugging
- Configuración persistente

## Instalación

### 1. Compilar el proyecto:
```bash
cd /path/to/ble-scanner-node/bluetooth
qmake BLE_Scanner.pro
make
```

### 2. Instalar dependencias:
```bash
chmod +x install_ble_dependencies.sh
sudo ./install_ble_dependencies.sh
```

### 3. Ejecutar:
```bash
./ble_scanner
```

## Configuración

### Variables principales (en BLE_Scanner.pro):
- `TARGET_MAC_PREFIX="BC:57:29"` - Prefijo objetivo
- `SCAN_RANGE=80` - Rango en metros
- `UNIT_NAME="QT_BLE_SCANNER"` - Identificador

### Rutas del sistema:
- Base de datos: `/usr/bin/application/ble/beacons.db`
- Logs: `/usr/bin/application/ble/ble.log`
- Config: `/usr/bin/application/ble/ble.config`

## Estructura del proyecto

```
bluetooth/
├── ble_gap.h              # Header principal BLE
├── ble_gap.cpp            # Implementación BLE
├── ble_main.cpp           # Punto de entrada
├── BLE_Scanner.pro        # Configuración Qt
├── messagebox_dummy.*     # MessageBox alternativo
├── ble_resources.qrc      # Recursos Qt
├── ble_scanner.desktop    # Desktop entry
└── install_ble_dependencies.sh # Script de instalación
```

## Uso

### Interfaz principal:
1. **Habilitar Bluetooth** - Checkbox para encender/apagar BT
2. **Escanear** - Botón para iniciar/detener escaneo BLE  
3. **Listas de dispositivos:**
   - **Descubiertos:** Dispositivos BLE encontrados
   - **Conectados:** Dispositivos marcados como activos
4. **Funciones:** Conectar, Desconectar, Limpiar

### Base de datos:
Compatible con tu esquema Node.js existente:
```sql
beacon_events (
  id, deviceId, beaconMac, name, rssi, rssi_discard,
  timestamp, type, uuid, major, minor, txPower,
  namespace, instance, distance, distanceInM,
  eventState, f_inicio, f_final, unit,
  manufacturerData, serviceData, syncStatus, syncTimestamp
)
```

## Depuración

### Logs en tiempo real:
```bash
tail -f /usr/bin/application/ble/ble.log
```

### Debug en consola:
El ejecutable muestra logs detallados con timestamps y categorías (INIT, SCAN, DISCOVER, ERROR, etc.)

## Comparación con tu sistema Node.js

| Aspecto | Node.js + bluetoothctl | Qt/C++ BLE |
|---------|------------------------|-------------|
| **Estabilidad** | ❌ Reinicios constantes | ✅ Sin reinicios |
| **CPU** | ❌ Alto (subprocess) | ✅ Bajo (nativo) |
| **Memoria** | ❌ Node.js + proceso | ✅ Solo Qt |
| **UI** | ❌ Solo web | ✅ Nativa + web |
| **Mantenimiento** | ❌ Complejo | ✅ Simple |
| **Debugging** | ❌ Logs dispersos | ✅ Centralizados |

## Migración

Para migrar desde tu sistema Node.js actual:

1. **Mantener datos:** La base de datos es 100% compatible
2. **Ejecutar en paralelo:** Puedes probar sin afectar el sistema actual
3. **Aprovechar web-viewer:** Tu web-viewer.js seguirá funcionando
4. **Gradual:** Reemplazar solo el scanning, mantener el resto

## Troubleshooting

### Error "No se encontró adaptador Bluetooth":
```bash
sudo hciconfig hci0 up
sudo systemctl restart bluetooth
```

### Error de permisos:
```bash
sudo usermod -a -G bluetooth $USER
# Reiniciar sesión
```

### Qt Bluetooth no disponible:
```bash
# En Yocto, asegúrate de tener:
# qtbase qtconnectivity
```