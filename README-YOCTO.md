# 🔵 BLE Scanner para Tablet Yocto

Sistema de escaneo y monitoreo de beacons BLE diseñado específicamente para tablets con Yocto Linux. Utiliza `btmon` para detección de dispositivos BLE y ofrece sincronización HTTP y MQTT para envío de datos.

## 🚀 Características

- ✅ **Escaneo BLE nativo** con `btmon` (compatible con Yocto)
- ✅ **Detección selectiva** por prefijo MAC configurable
- ✅ **Sincronización HTTP** automática con API REST
- ✅ **Publicación MQTT** para integración en tiempo real
- ✅ **Base de datos SQLite** local con respaldo
- ✅ **Gestión PM2** para alta disponibilidad
- ✅ **Optimizado para sistemas embebidos** con recursos limitados

## 🛠️ Tecnologías

- **Node.js LTS** (v20.x) - Runtime JavaScript
- **SQLite3** - Base de datos local
- **btmon** - Monitor BLE de BlueZ
- **PM2** - Gestor de procesos
- **MQTT** - Protocolo de mensajería ligero
- **crypto** - Generación UUID nativa

## 📋 Requisitos del Sistema

### Hardware
- **Tablet con Yocto Linux**
- **Bluetooth 4.0+** (BLE compatible)
- **Mínimo 4GB RAM** (recomendado)
- **Almacenamiento**: 2GB+ disponibles

### Software
- **Yocto Linux** con BlueZ 5.x
- **Node.js LTS** (v20.x)
- **PM2** (gestor de procesos)
- **Herramientas BLE**: `btmon`, `hciconfig`, `hcitool`

## 🔧 Instalación Completa

### 1. Preparar Almacenamiento (51GB adicionales)
```bash
# Verificar particiones
lsblk

# Montar partición de datos
mkdir -p /data
mount /dev/mmcblk2p7 /data

# Configurar montaje automático
echo "UUID=12a6b7a2-9f5a-462e-9d8e-32ec02f3e141 /data ext4 defaults 0 2" >> /etc/fstab
```

### 2. Instalar Node.js LTS
```bash
# Descargar Node.js LTS para ARM64
cd /tmp
wget https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-arm64.tar.xz

# Extraer en /data
cd /data
tar -xf /tmp/node-v20.10.0-linux-arm64.tar.xz
mv node-v20.10.0-linux-arm64 nodejs

# Configurar enlaces y PATH
ln -sf /data/nodejs/bin/node /usr/bin/node
ln -sf /data/nodejs/bin/npm /usr/bin/npm
export PATH="/data/nodejs/bin:$PATH"
echo 'export PATH="/data/nodejs/bin:$PATH"' >> ~/.bashrc
```

### 3. Instalar Dependencias del Sistema
```bash
# Herramientas Bluetooth
opkg update
opkg install bluez5-utils bluez5-dev

# Activar Bluetooth
systemctl enable bluetooth
systemctl start bluetooth
hciconfig hci0 up
```

### 4. Clonar e Instalar Proyecto
```bash
# Crear estructura
mkdir -p /data/www /data/logs /data/databases

# Clonar proyecto
cd /data/www
git clone https://github.com/BryanLlerena/ble-scanner-node.git
cd ble-scanner-node

# Instalar dependencias
npm install

# Instalar PM2
npm install -g pm2
ln -sf /data/nodejs/bin/pm2 /usr/bin/pm2
```

## ⚙️ Configuración

### Archivo `.env`
```bash
# Copiar plantilla
cp .env.example .env
nano .env
```

### Variables Principales
```bash
# Configuración BLE
UNIT=TABLET_01
TARGET_MAC_PREFIX=64:68:00
SCAN_RANGE=80
DEBOUNCE_TIME=300
BEACON_TIMEOUT=3000

# Base de datos
DB_FILE=/data/databases/beacons.db

# API de sincronización
API_BASE_URL=http://172.236.110.18:3001/api/v1
SYNC_INTERVAL=30000
SKIP_INTERNET_CHECK=false

# MQTT (opcional)
MQTT_BROKER=mqtt://broker:1883
MQTT_COMPANY=gunjop
MQTT_INTERVAL=60000

# Sistema
LOG_LEVEL=info
NODE_ENV=production
```

## 🚀 Ejecución

### Inicio Manual
```bash
cd /data/www/ble-scanner-node

# Escaneo BLE únicamente
node index.js

# Sincronización únicamente
node sync-processor.js

# Servicio MQTT únicamente
node sync-mqtt.js
```

### Inicio con PM2 (Recomendado)
```bash
# Configurar inicio automático
pm2 startup
# Ejecutar comando sugerido por PM2

# Iniciar todos los servicios
pm2 start ecosystem.config.json

# Guardar configuración
pm2 save

# Ver estado
pm2 status
```

## 📊 Servicios PM2

| Servicio | Script | Descripción |
|----------|---------|-------------|
| `ble-scanner` | `index.js` | Escaneo BLE con btmon |
| `sync-processor` | `sync-processor.js` | Sincronización HTTP |
| `mqtt-service` | `sync-mqtt.js` | Publicación MQTT |

## 📈 Monitoreo

### Comandos Básicos
```bash
# Estado de servicios
pm2 status

# Logs en tiempo real
pm2 logs

# Monitor de recursos
pm2 monit

# Logs específicos
pm2 logs ble-scanner
pm2 logs sync-processor
```

### Verificación del Sistema
```bash
# Estado Bluetooth
hciconfig
systemctl status bluetooth

# Espacio en disco
df -h

# Memoria RAM
free -h

# Base de datos
node view-data.js
```

## 🔄 Gestión de Datos

### Base de Datos SQLite
- **Ubicación**: `/data/databases/beacons.db`
- **Tabla principal**: `beacon_events`
- **Campos**: MAC, RSSI, timestamps, ubicación, etc.

### Scripts Útiles
```bash
# Ver datos almacenados
node view-data.js

# Eliminar datos antiguos
node delete-data.js

# Estado de sincronización
node sync-status.js

# Regenerar UUIDs
node regenerate-uuids.js
```

## 🌐 API REST

### Endpoints de Sincronización
- **POST** `/api/v1/beacon-track/many` - Envío masivo
- **PUT** `/api/v1/beacon-track/{uuid}` - Actualización individual

### Formato de Datos
```json
{
  "mac": "64:68:00:10:25:A0",
  "unit": "TABLET_01",
  "f_inicio": 1701234567890,
  "f_final": 1701234868890,
  "rssi_min": -65,
  "rssi_max": -45,
  "rssi_mean": -55,
  "distance": 2.5,
  "uuid": "550e8400-e29b-41d4-a716-446655440000-TABLET_01"
}
```

## 📡 MQTT

### Topics
- **Tracking**: `{company}/unit/{unit}/tracking`
- **Status**: `{company}/unit/{unit}/status`

### Configuración
```bash
# Variables MQTT en .env
MQTT_BROKER=mqtt://broker:1883
MQTT_COMPANY=gunjop
MQTT_USERNAME=usuario
MQTT_PASSWORD=contraseña
```

## 🔧 Mantenimiento

### Actualizaciones
```bash
cd /data/www/ble-scanner-node
git pull
npm install
pm2 restart all
```

### Limpieza
```bash
# Limpiar logs PM2
pm2 flush

# Limpiar cache npm
npm cache clean --force

# Verificar espacio
du -sh /data/*
```

### Backup
```bash
# Base de datos
cp /data/databases/beacons.db /data/backups/beacons_$(date +%Y%m%d).db

# Configuración
cp /data/www/ble-scanner-node/.env /data/backups/env_$(date +%Y%m%d).backup
```

## 🐛 Solución de Problemas

### BLE no funciona
```bash
# Reiniciar Bluetooth
systemctl restart bluetooth
hciconfig hci0 down && hciconfig hci0 up

# Verificar permisos
ls -la /dev/hci*

# Probar btmon
timeout 10 btmon -i hci0
```

### PM2 no inicia automáticamente
```bash
pm2 startup
pm2 save
systemctl enable pm2-root
```

### Problemas de sincronización
```bash
# Verificar conectividad
ping -c 3 172.236.110.18
curl -I http://172.236.110.18:3001/api/v1

# Ver logs detallados
pm2 logs sync-processor --lines 100
```

### Espacio insuficiente
```bash
# Verificar uso
df -h
du -sh /data/*

# Limpiar datos antiguos
node delete-data.js --older-than 30
```

## 📞 Soporte

### Logs del Sistema
```bash
# Logs completos
pm2 logs --lines 200

# Solo errores
pm2 logs | grep ERROR

# Logs del sistema
journalctl -u bluetooth -f
```

### Información del Sistema
```bash
# Versiones
node --version
npm --version
pm2 --version

# Hardware
uname -a
lsblk
free -h
```

## 🔄 Estructura del Proyecto

```
ble-scanner-node/
├── 📄 index.js              # Escaneo BLE principal
├── 📄 sync-processor.js     # Sincronización HTTP
├── 📄 sync-mqtt.js          # Publicación MQTT
├── 📄 ecosystem.config.json # Configuración PM2
├── 📄 package.json          # Dependencias Node.js
├── 📁 logs/                 # Archivos de log
├── 📁 public/               # Archivos web estáticos
└── 📄 .env                  # Variables de entorno
```

## 🌟 Funcionalidades Principales

### Escaneo BLE con btmon
- **Detección nativa** sin dependencias Node.js pesadas
- **Filtrado por MAC** para optimizar procesamiento
- **Parsing ANSI** para datos estructurados
- **Manejo robusto** de reconexiones Bluetooth

### Sincronización Inteligente
- **Detección automática** de conexión WiFi
- **Reintento automático** en fallos de red
- **Estados de sincronización** (pending/sent/updated)
- **Batch processing** para optimizar transferencias

### Gestión de Energía
- **Optimizaciones para tablet** con batería limitada
- **Logging mínimo** en producción
- **Gestión eficiente** de procesos hijo
- **Cleanup automático** de recursos

## 📋 Lista de Verificación Post-Instalación

### ✅ Sistema Base
- [ ] Partición de datos montada en `/data`
- [ ] Node.js LTS v20.x instalado correctamente
- [ ] Bluetooth activo y funcional
- [ ] PM2 configurado para inicio automático

### ✅ Aplicación
- [ ] Repositorio clonado en `/data/www/ble-scanner-node`
- [ ] Dependencias npm instaladas
- [ ] Archivo `.env` configurado
- [ ] Servicios PM2 ejecutándose

### ✅ Conectividad
- [ ] Ping a servidor API exitoso
- [ ] Detección WiFi funcional
- [ ] MQTT conectado (si aplica)
- [ ] Base de datos creada automáticamente

## 💡 Consejos de Optimización

### Rendimiento
```bash
# Ajustar intervalo de sincronización según necesidades
SYNC_INTERVAL=60000  # Para menor carga de red

# Reducir timeout de beacons si no es crítico
BEACON_TIMEOUT=180   # 3 minutos en lugar de 5

# Usar logging mínimo en producción
LOG_LEVEL=error
```

### Almacenamiento
```bash
# Configurar rotación de logs PM2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# Limpiar automáticamente datos antiguos
0 2 * * * /data/nodejs/bin/node /data/www/ble-scanner-node/delete-data.js --older-than 30 --closed
```

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 👥 Contribución

1. Fork del proyecto
2. Crear rama de feature (`git checkout -b feature/AmazingFeature`)
3. Commit de cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

---

**Desarrollado para tablets Yocto Linux con Node.js LTS** 🚀