# 🔵 BLE Scanner para Tablet Yocto (Storage Edition)

Sistema de escaneo y monitoreo de beacons BLE diseñado específicamente para tablets con Yocto Linux. Utiliza `btmon` para detección de dispositivos BLE y ofrece sincronización HTTP y MQTT para envío de datos.

> [!IMPORTANT]
> Esta versión está optimizada para instalación en `/mnt/storage` con persistencia completa de datos.

## 🚀 Características

- ✅ **Escaneo BLE nativo** con `btmon` (compatible con Yocto)
- ✅ **Detección selectiva** por prefijo MAC configurable
- ✅ **Sincronización HTTP** automática con API REST
- ✅ **Publicación MQTT** para integración en tiempo real
- ✅ **Base de datos SQLite** local con respaldo
- ✅ **Gestión PM2** para alta disponibilidad
- ✅ **Optimizado para sistemas embebidos** con recursos limitados
- ✅ **Almacenamiento persistente** en `/mnt/storage`

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
- **Almacenamiento**: 2GB+ disponibles en `/mnt/storage`

### Software
- **Yocto Linux** con BlueZ 5.x
- **Node.js LTS** (v20.x)
- **PM2** (gestor de procesos)
- **Herramientas BLE**: `btmon`, `hciconfig`, `hcitool`

## 🔧 Instalación Completa

### 1. Verificar y Preparar `/mnt/storage`

```bash
# Verificar que /mnt/storage esté montado
df -h | grep storage
lsblk

# Si no está montado, montarlo
mount /dev/mmcblk2p7 /mnt/storage

# Verificar espacio disponible (mínimo 2GB recomendado)
df -h /mnt/storage

# Configurar montaje automático en /etc/fstab (si no está ya)
# Agregar esta línea si es necesario:
# UUID=<tu-uuid> /mnt/storage ext4 defaults 0 2

# Verificar permisos
ls -la /mnt/storage
chown -R root:root /mnt/storage
chmod 755 /mnt/storage
```

### 2. Crear Estructura de Directorios

```bash
# Crear estructura completa en /mnt/storage
mkdir -p /mnt/storage/nodejs
mkdir -p /mnt/storage/www
mkdir -p /mnt/storage/logs
mkdir -p /mnt/storage/databases
mkdir -p /mnt/storage/backups
mkdir -p /mnt/storage/home/root

# Verificar estructura
tree -L 2 /mnt/storage
```

### 3. Instalar Node.js LTS

```bash
# Descargar Node.js LTS para ARM64
cd /tmp
wget https://nodejs.org/dist/v20.10.0/node-v20.10.0-linux-arm64.tar.xz

# Extraer en /mnt/storage
cd /mnt/storage
tar -xf /tmp/node-v20.10.0-linux-arm64.tar.xz
mv node-v20.10.0-linux-arm64 nodejs

# Configurar enlaces simbólicos
ln -sf /mnt/storage/nodejs/bin/node /usr/bin/node
ln -sf /mnt/storage/nodejs/bin/npm /usr/bin/npm

# Configurar PATH permanentemente
export PATH="/mnt/storage/nodejs/bin:$PATH"
echo 'export PATH="/mnt/storage/nodejs/bin:$PATH"' >> /mnt/storage/home/root/.bashrc

# Verificar instalación
node --version
npm --version
```

### 4. Instalar Dependencias del Sistema

```bash
# Actualizar repositorios
opkg update

# Herramientas Bluetooth
opkg install bluez5-utils bluez5-dev

# Activar y configurar Bluetooth
systemctl enable bluetooth
systemctl start bluetooth
hciconfig hci0 up

# Verificar Bluetooth
hciconfig
systemctl status bluetooth
```

### 5. Clonar e Instalar Proyecto

```bash
# Navegar al directorio de aplicaciones
cd /mnt/storage/www

# Clonar proyecto (branch tablet-at)
git clone -b tablet-at https://github.com/BryanLlerena/ble-scanner-node.git
cd ble-scanner-node

# Instalar dependencias del proyecto
npm install

# Instalar PM2 globalmente
npm install -g pm2
ln -sf /mnt/storage/nodejs/bin/pm2 /usr/bin/pm2

# Verificar instalación PM2
pm2 --version
```

## ⚙️ Configuración

### Archivo `.env`

```bash
# Copiar plantilla de ejemplo
cd /mnt/storage/www/ble-scanner-node
cp .env.example .env

# Editar configuración
nano .env
```

### Variables Principales

```bash
# ============================================
# CONFIGURACIÓN BLE
# ============================================
UNIT=TABLET_01
TARGET_MAC_PREFIX=64:68:00
SCAN_RANGE=80
DEBOUNCE_TIME=300
BEACON_TIMEOUT=3000

# ============================================
# BASE DE DATOS (¡IMPORTANTE! Ruta en storage)
# ============================================
DB_FILE=/mnt/storage/databases/beacons.db

# ============================================
# API DE SINCRONIZACIÓN
# ============================================
API_BASE_URL=http://172.236.110.18:3001/api/v1
SYNC_INTERVAL=30000
SKIP_INTERNET_CHECK=false

# ============================================
# MQTT (OPCIONAL)
# ============================================
MQTT_BROKER=mqtt://broker:1883
MQTT_COMPANY=gunjop
MQTT_INTERVAL=60000
MQTT_USERNAME=
MQTT_PASSWORD=

# ============================================
# SISTEMA
# ============================================
LOG_LEVEL=info
NODE_ENV=production
```

## 🚀 Ejecución

### Configurar PM2 para Inicio Automático

```bash
# Configurar PM2 startup
pm2 startup

# IMPORTANTE: Ejecutar el comando que PM2 sugiere
# Ejemplo: env PATH=$PATH:/mnt/storage/nodejs/bin pm2 startup systemd -u root --hp /mnt/storage/home/root
```

### Iniciar Servicios

```bash
cd /mnt/storage/www/ble-scanner-node

# Iniciar todos los servicios con PM2
pm2 start ecosystem.config.json

# Guardar configuración para reinicio automático
pm2 save

# Verificar estado
pm2 status
pm2 logs
```

### Inicio Manual (para pruebas)

```bash
cd /mnt/storage/www/ble-scanner-node

# Escaneo BLE únicamente
node index.js

# Sincronización únicamente
node sync-processor.js

# Servicio MQTT únicamente
node sync-mqtt.js
```

## 📊 Servicios PM2

| Servicio | Script | Descripción | Ruta |
|----------|---------|-------------|------|
| `ble-scanner` | `index.js` | Escaneo BLE con btmon | `/mnt/storage/www/ble-scanner-node` |
| `sync-processor` | `sync-processor.js` | Sincronización HTTP | `/mnt/storage/www/ble-scanner-node` |
| `mqtt-service` | `sync-mqtt.js` | Publicación MQTT | `/mnt/storage/www/ble-scanner-node` |

## 📈 Monitoreo

### Comandos Básicos

```bash
# Estado de servicios
pm2 status

# Logs en tiempo real (todos los servicios)
pm2 logs

# Monitor de recursos (CPU, memoria)
pm2 monit

# Logs específicos por servicio
pm2 logs ble-scanner
pm2 logs sync-processor
pm2 logs mqtt-service

# Ver últimas 100 líneas
pm2 logs --lines 100
```

### Verificación del Sistema

```bash
# Estado Bluetooth
hciconfig
systemctl status bluetooth

# Espacio en disco de /mnt/storage
df -h /mnt/storage
du -sh /mnt/storage/*

# Memoria RAM
free -h

# Base de datos
node /mnt/storage/www/ble-scanner-node/view-data.js

# Verificar montaje persistente
cat /etc/fstab | grep storage
mount | grep storage
```

## 🔄 Gestión de Datos

### Base de Datos SQLite

- **Ubicación**: `/mnt/storage/databases/beacons.db`
- **Tabla principal**: `beacon_events`
- **Campos**: MAC, RSSI, timestamps, ubicación, UUID, etc.

### Scripts Útiles

```bash
cd /mnt/storage/www/ble-scanner-node

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

- **POST** `/api/v1/beacon-track/many` - Envío masivo de eventos
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
MQTT_BROKER=mqtt://broker.example.com:1883
MQTT_COMPANY=gunjop
MQTT_USERNAME=usuario
MQTT_PASSWORD=contraseña
```

## 🔧 Mantenimiento

### Actualizaciones

```bash
cd /mnt/storage/www/ble-scanner-node

# Actualizar código
git pull origin tablet-at

# Actualizar dependencias
npm install

# Reiniciar servicios
pm2 restart all

# Verificar estado
pm2 status
```

### Limpieza

```bash
# Limpiar logs PM2
pm2 flush

# Limpiar cache npm
npm cache clean --force

# Verificar espacio usado
du -sh /mnt/storage/*

# Limpiar archivos temporales
rm -rf /tmp/*
```

### Backup

```bash
# Crear directorio de backups si no existe
mkdir -p /mnt/storage/backups

# Backup de base de datos
cp /mnt/storage/databases/beacons.db \
   /mnt/storage/backups/beacons_$(date +%Y%m%d_%H%M%S).db

# Backup de configuración
cp /mnt/storage/www/ble-scanner-node/.env \
   /mnt/storage/backups/env_$(date +%Y%m%d_%H%M%S).backup

# Backup del proyecto completo
tar -czf /mnt/storage/backups/ble-scanner_$(date +%Y%m%d).tar.gz \
   /mnt/storage/www/ble-scanner-node

# Listar backups
ls -lh /mnt/storage/backups/
```

## 🐛 Solución de Problemas

### BLE no funciona

```bash
# Reiniciar Bluetooth
systemctl restart bluetooth
hciconfig hci0 down && hciconfig hci0 up

# Verificar permisos de dispositivo
ls -la /dev/hci*

# Probar btmon manualmente
timeout 10 btmon -i hci0

# Ver logs del sistema Bluetooth
journalctl -u bluetooth -f
```

### PM2 no inicia automáticamente

```bash
# Reconfigurar PM2 startup
pm2 unstartup
pm2 startup

# Ejecutar comando sugerido por PM2
# Ejemplo: env PATH=$PATH:/mnt/storage/nodejs/bin pm2 startup systemd -u root --hp /mnt/storage/home/root

# Guardar configuración actual
pm2 save

# Verificar servicio systemd
systemctl status pm2-root
systemctl enable pm2-root
```

### Problemas de sincronización

```bash
# Verificar conectividad de red
ping -c 3 172.236.110.18

# Probar endpoint API
curl -I http://172.236.110.18:3001/api/v1

# Ver logs detallados de sincronización
pm2 logs sync-processor --lines 100

# Verificar configuración .env
cat /mnt/storage/www/ble-scanner-node/.env | grep API
```

### `/mnt/storage` no está montado

```bash
# Verificar partición
lsblk
df -h

# Montar manualmente
mount /dev/mmcblk2p7 /mnt/storage

# Verificar fstab
cat /etc/fstab | grep storage

# Agregar a fstab si falta (reemplaza UUID con el tuyo)
echo "UUID=$(blkid -s UUID -o value /dev/mmcblk2p7) /mnt/storage ext4 defaults 0 2" >> /etc/fstab

# Probar montaje desde fstab
mount -a
```

### Espacio insuficiente

```bash
# Verificar uso de disco
df -h /mnt/storage
du -sh /mnt/storage/*

# Limpiar datos antiguos de la base de datos
cd /mnt/storage/www/ble-scanner-node
node delete-data.js --older-than 30

# Limpiar logs antiguos
pm2 flush
find /mnt/storage/logs -type f -mtime +7 -delete

# Limpiar backups antiguos
find /mnt/storage/backups -type f -mtime +30 -delete
```

## 📞 Soporte

### Logs del Sistema

```bash
# Logs completos de PM2
pm2 logs --lines 200

# Solo errores
pm2 logs | grep ERROR

# Logs del sistema Bluetooth
journalctl -u bluetooth -f

# Logs de systemd para PM2
journalctl -u pm2-root -f
```

### Información del Sistema

```bash
# Versiones de software
node --version
npm --version
pm2 --version

# Información de hardware
uname -a
lsblk
free -h

# Estado de montajes
mount | grep storage
df -h /mnt/storage
```

## 🔄 Estructura del Proyecto en Storage

```
/mnt/storage/
├── 📁 nodejs/                      # Node.js LTS v20.x
│   ├── bin/
│   │   ├── node
│   │   ├── npm
│   │   └── pm2
│   └── lib/
├── 📁 www/                         # Aplicaciones web
│   └── ble-scanner-node/
│       ├── 📄 index.js             # Escaneo BLE principal
│       ├── 📄 sync-processor.js    # Sincronización HTTP
│       ├── 📄 sync-mqtt.js         # Publicación MQTT
│       ├── 📄 ecosystem.config.json # Configuración PM2
│       ├── 📄 package.json         # Dependencias Node.js
│       ├── 📄 .env                 # Variables de entorno
│       └── 📁 public/              # Archivos estáticos
├── 📁 databases/                   # Bases de datos SQLite
│   └── beacons.db
├── 📁 logs/                        # Logs de aplicación
├── 📁 backups/                     # Respaldos
│   ├── beacons_*.db
│   └── env_*.backup
└── 📁 home/                        # Homes de usuarios
    └── root/
        └── .bashrc
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
- [ ] `/mnt/storage` montado y con espacio suficiente (2GB+)
- [ ] `/mnt/storage` configurado en `/etc/fstab` para montaje automático
- [ ] Node.js LTS v20.x instalado en `/mnt/storage/nodejs`
- [ ] Enlaces simbólicos de `node`, `npm`, `pm2` creados en `/usr/bin`
- [ ] PATH configurado en `/mnt/storage/home/root/.bashrc`
- [ ] Bluetooth activo y funcional (`hciconfig hci0 up`)

### ✅ Aplicación
- [ ] Repositorio clonado en `/mnt/storage/www/ble-scanner-node`
- [ ] Branch `tablet-at` activo
- [ ] Dependencias npm instaladas correctamente
- [ ] Archivo `.env` configurado con rutas correctas
- [ ] Variable `DB_FILE=/mnt/storage/databases/beacons.db` en `.env`
- [ ] PM2 configurado para inicio automático
- [ ] Servicios PM2 ejecutándose (`pm2 status`)
- [ ] Configuración PM2 guardada (`pm2 save`)

### ✅ Conectividad
- [ ] Ping a servidor API exitoso
- [ ] Endpoint API accesible (`curl` exitoso)
- [ ] Detección WiFi funcional
- [ ] MQTT conectado (si aplica)
- [ ] Base de datos SQLite creada automáticamente

### ✅ Persistencia
- [ ] Datos persisten después de reinicio
- [ ] PM2 inicia automáticamente después de reinicio
- [ ] `/mnt/storage` se monta automáticamente
- [ ] Logs se almacenan correctamente

## 💡 Consejos de Optimización

### Rendimiento

```bash
# Ajustar intervalo de sincronización según necesidades
SYNC_INTERVAL=60000  # 60 segundos para menor carga de red

# Reducir timeout de beacons si no es crítico
BEACON_TIMEOUT=180   # 3 minutos en lugar de 5

# Usar logging mínimo en producción
LOG_LEVEL=error
```

### Almacenamiento

```bash
# Instalar rotación automática de logs PM2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

# Crear cron job para limpiar datos antiguos
# Editar crontab: crontab -e
# Agregar línea:
0 2 * * * /mnt/storage/nodejs/bin/node /mnt/storage/www/ble-scanner-node/delete-data.js --older-than 30 --closed
```

### Seguridad

```bash
# Permisos restrictivos para archivos sensibles
chmod 600 /mnt/storage/www/ble-scanner-node/.env
chmod 600 /mnt/storage/databases/beacons.db

# Backup automático diario
# Agregar a crontab:
0 3 * * * cp /mnt/storage/databases/beacons.db /mnt/storage/backups/beacons_$(date +\%Y\%m\%d).db
```

## 🔐 Ventajas de Usar `/mnt/storage`

1. **Persistencia Total**: Todos los datos sobreviven reinicios del sistema
2. **Espacio Dedicado**: Mayor capacidad que particiones del sistema
3. **Separación de Datos**: Sistema operativo separado de datos de aplicación
4. **Backups Simplificados**: Fácil respaldar toda la partición
5. **Escalabilidad**: Fácil migrar a dispositivos de mayor capacidad
6. **Organización**: Estructura clara y mantenible

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 👥 Contribución

1. Fork del proyecto
2. Crear rama de feature (`git checkout -b feature/AmazingFeature`)
3. Commit de cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

---

**Desarrollado para tablets Yocto Linux con almacenamiento en `/mnt/storage`** 🚀💾
