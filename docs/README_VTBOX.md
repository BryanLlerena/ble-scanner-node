# Marcobre VT-BOX Configuration Guide

## Overview
Complete guide for configuring VT-BOX with Node.js application, persistent storage (22GB), GPS, and PM2 process manager.

**Date:** December 13, 2025  
**Requirements:** Root access

---

## Step 1: System Unlock and Disk Format

⚠️ **WARNING**: `mkfs` will erase all data on partition 50.

```bash
umount /etc/ -l
mount -o remount rw /
mkfs.ext4 -F /dev/mmcblk0p50
```

### 1. Crear el archivo de configuración WiFi

```bash
cat <<EOF > /data/misc/wifi/wpa_supplicant.conf
ctrl_interface=/var/run/wpa_supplicant
ctrl_interface_group=0
update_config=1

# RED 1: Principal (Prioridad Alta)
network={
    ssid="GUNJOPERS"
    psk="gunjop2023"
    key_mgmt=WPA-PSK
    priority=10
}

# RED 2: brll-ryu (Prioridad Media)
network={
    ssid="UNDIS_CL"
    psk="%Undis2025%"
    key_mgmt=WPA-PSK
    priority=5
}

# RED 3: Respaldo (Prioridad Baja)
network={
    ssid="UNDIS_FMS_CL"
    psk="%cerrolindo123%"
    key_mgmt=WPA-PSK
    priority=3
}
EOF
```

### 2. Permisos de seguridad y Aplicar

```bash
# 2. Permisos de seguridad
chmod 600 /data/misc/wifi/wpa_supplicant.conf

# 3. Guardar en disco físico
sync
sync

# 4. Obligar al WiFi a leer la nueva configuración (Sin reiniciar)
wpa_cli -i wlan0 reconfigure

# 5. Después del reinicio
wpa_cli -i wlan0 status
```

### 3. Configurar Contraseña Root

```bash
passwd root
# Introduce: gunjop123
```

*(Opcional: Reiniciar `reboot`)*

---

## Step 2: Persistent Mount Service (mnt-storage)

Create a systemd service to mount internal storage at `/mnt/storage` and unmount SD card.

```bash

# 1. Desbloquear sistema (Rutina obligatoria)
umount /etc/ -l
mount -o remount rw /

# 2. Crear el servicio corregido
cat > /etc/systemd/system/mnt-storage.service << 'EOF'
[Unit]
Description=Mount mmcblk0p50 to /mnt/storage
After=local-fs.target systemd-tmpfiles-setup.service
Requires=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes

# 1. Crear carpeta
ExecStartPre=/bin/mkdir -p /mnt/storage

# 2. LIMPIEZA PREVIA: Intentar desmontar por si acaso ya estaba montado.
ExecStartPre=-/bin/umount /mnt/storage

# 3. Montar disco (Ahora sí funcionará limpio)
ExecStart=/bin/mount -t ext4 /dev/mmcblk0p50 /mnt/storage

# 4. Limpiar SD Card (Con guion '-' para ignorar si no existe)
ExecStartPost=-/bin/umount -l /mnt/sdcard

# Desmontar al apagar
ExecStop=/bin/umount /mnt/storage

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
systemctl daemon-reload
systemctl enable mnt-storage.service
systemctl start mnt-storage.service
```

### Asegúrate de saber cuál es tu partición (ej. /dev/mmcblk0pX) si necesitas montarla manual

```bash
cd /mnt/storage

# Crear directorios para aislamiento de datos
mkdir -p /mnt/storage/.npm
mkdir -p /mnt/storage/.pm2
```

### Step 2.1: Instalar script de GPS runner

Este script es necesario para simular la señal GPS y debe estar disponible en `/usr/bin/gps_runner.sh`.

```bash
umount /etc/ -l
mount -o remount rw /

# Crear el script gps_runner.sh
cat <<'EOF' > /usr/bin/gps_runner.sh
#!/bin/sh
(
    echo "90"; sleep 1
    echo "92"; sleep 1
    while true; do echo "95"; sleep 1; done
) | script -q -c "/usr/bin/qlril-api-test" /dev/null
EOF

chmod +x /usr/bin/gps_runner.sh
```

> Este paso es necesario antes de iniciar cualquier servicio que dependa de la lectura de GPS.

## Step 3: Descargar e Instalar Node.js (v22.21.1)

```bash
# Descargar binarios
wget --no-check-certificate https://nodejs.org/dist/v22.21.1/node-v22.21.1-linux-arm64.tar.xz -P /tmp

# Validar descarga
ls -lh /tmp/node-v22.21.1-linux-arm64.tar.xz

# Descomprimir en /mnt/storage
cd /mnt/storage
tar -xf /tmp/node-v22.21.1-linux-arm64.tar.xz

# Renombrar carpeta
mv node-v22.21.1-linux-arm64 nodejs

# Limpiar archivos temporales
rm /tmp/node-v22.21.1-linux-arm64.tar.xz
```

## Step 4: Configuración del Sistema

```bash
# Enlaces Simbólicos
ln -sf /mnt/storage/nodejs/bin/node /usr/bin/node
ln -sf /mnt/storage/nodejs/bin/npm /usr/bin/npm
ln -sf /mnt/storage/nodejs/bin/npx /usr/bin/npx

# Agregar Binarios al Path y Configurar PM2_HOME para persistencia
export PATH="/mnt/storage/nodejs/bin:$PATH"
export PM2_HOME="/mnt/storage/.pm2"

# Hacer persistente en /etc/profile
echo 'export PATH="/mnt/storage/nodejs/bin:$PATH"' >> /etc/profile
echo 'export PM2_HOME="/mnt/storage/.pm2"' >> /etc/profile
```

### Configurar NPM y Verificar

```bash
# Configurar cache de npm en storage (Vital para evitar llenar root)
npm config set cache /mnt/storage/.npm --global

# Verificar instalación
node --version
npm --version
```

## Step 5: Instalar PM2

```bash
# Instalar Pm2 globalmente
npm install -g pm2
ln -sf /mnt/storage/nodejs/bin/pm2 /usr/bin/pm2

# Iniciar pm2 al reiniciar
# PM2 usará el PM2_HOME definido en el paso 4
pm2 startup
```

## Step 6: Arrancar Aplicación con PM2

Una vez instalado todo, para levantar la aplicación y que persista:

```bash
# Ir al directorio del proyecto (ejemplo)
mkdir -p /mnt/storage/www
cd /mnt/storage/www

git clone https://github.com/BryanLlerena/ble-scanner-node.git
cd /mnt/storage/www/ble-scanner-node

# Instalar dependencias del proyecto (si hace falta)
npm install

# Copiar .env
vi .env

# Copiar y pergar .env.example
:wq

# Iniciar procesos
pm2 start ecosystem.config.js

# Guardar la lista de procesos para el reinicio (CRÍTICO)
pm2 save

# Verificar
pm2 status
```

---

## ** Configuración de Bluetooth (Noble - Yocto/Opkg) **

Para que `@abandonware/noble` funcione correctamente en tu VTBOX (que usa `opkg`), sigue estos pasos adicionales.

### 1. Actualizar e Instalar BlueZ
```bash
opkg update

# Instalar el paquete principal de BlueZ
opkg install bluez5

```

### 7. Verificar con Script de JS
```bash
cd /mnt/storage/www/ble-scanner-node
node test-noble.js
```

## Step 9: Bluetooth Persistence (Hybrid V2 - Final)

This method forces a fresh start of the Bluetooth service on every boot using PM2. We use a "Long-Running Trigger" so PM2 always sees it as ONLINE and restarts it automatically.

### 1. Create Robust Init Script (init-bluetooth.sh)

```bash
cat > /usr/bin/init-bluetooth.sh << 'EOF'
#!/bin/sh
LOG=/tmp/bluetooth-init.log
echo "Starting Bluetooth init (v6) at $(date)" > $LOG

# 1. Unblock RFKill (Relative path)
echo "Unblocking all radio..." >> $LOG
rfkill unblock all >> $LOG 2>&1 || true
sleep 1

# 2. Cleanup old processes
echo "Cleaning previous instances..." >> $LOG
killall hciattach > /dev/null 2>&1 || true
sleep 3

# 3. Attach UART (Background process)
echo "Running hciattach..." >> $LOG
/usr/bin/hciattach /dev/ttyHS0 qca 115200 flow >> $LOG 2>&1 &
ATTACH_PID=$!
echo "hciattach started with PID $ATTACH_PID" >> $LOG

# 4. Wait Loop (30s timeout)
echo "Waiting for hci0..." >> $LOG
COUNT=0
while [ $COUNT -lt 30 ]; do
    if /usr/bin/hciconfig -a | grep -q "hci0"; then
        echo "Device hci0 FOUND!" >> $LOG
        break
    fi
    sleep 1
    COUNT=$((COUNT+1))
    echo -n "." >> $LOG
done

# 5. Fallback Diagnosis
if [ $COUNT -ge 30 ]; then
    echo "TIMEOUT: hci0 not found. Forcing UP..." >> $LOG
fi

# 6. Bring Interface UP
/usr/bin/hciconfig hci0 up >> $LOG 2>&1
/usr/bin/hciconfig hci0 piscan >> $LOG 2>&1

# 7. Final Verification
echo "Final device status:" >> $LOG
/usr/bin/hciconfig -a >> $LOG 2>&1

# 8. Restart Application
echo "Restarting PM2 process (ble-scanner)..." >> $LOG
export PM2_HOME="/mnt/storage/.pm2"
# Restart the specific app name
/usr/bin/pm2 restart ble-scanner >> $LOG 2>&1

echo "Finished at $(date)" >> $LOG
exit 0
EOF

# Grant execution permissions
chmod +x /usr/bin/init-bluetooth.sh
```

### 2. Create Systemd Service Wrapper

```bash
cat > /etc/systemd/system/attach-bluetooth.service << 'EOF'
[Unit]
Description=Attach Qualcomm Bluetooth UART (Wrapper)

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/init-bluetooth.sh

[Install]
WantedBy=multi-user.target
EOF

# Reload Systemd and DISABLE auto-start (managed by PM2)
systemctl daemon-reload
systemctl disable attach-bluetooth.service
```

### 3. Create PM2 Trigger Script (Long-Running)

We make the script sleep forever so PM2 sees it as "ONLINE" and always restarts it on boot.

```bash
cat > /usr/bin/start-bluetooth-service.sh << 'EOF'
#!/bin/sh
echo "PM2 Trigger: RESTARTS Bluetooth Service..."
# Use RESTART to force execution
systemctl restart attach-bluetooth.service
echo "Service restarted! Sleeping to keep process alive..."
# Sleep forever to keep PM2 happy (Status: ONLINE)
exec sleep infinity
EOF

# Grant execution permissions
chmod +x /usr/bin/start-bluetooth-service.sh
```

### 4. Register Trigger in PM2

```bash
# Delete old process if exists
pm2 delete bt-trigger 2>/dev/null || true

# Start new trigger process (Standard mode, autoruns on boot)
pm2 start /usr/bin/start-bluetooth-service.sh --name "bt-trigger"

# Save process list
pm2 save
```

### 5. Verification

After reboot (`reboot`), verify execution:

```bash
# Check PM2 trigger status (Should be ONLINE)
pm2 list

# Check internal script log
cat /tmp/bluetooth-init.log

# Check Bluetooth interface status
hciconfig -a
```   


---

## Conexion Serial (Debug)

Si necesitas acceder por puerto serial (desde Mac):
```bash
screen /dev/cu.PL2303G-USBtoUART1120 115200
# Para salir: Ctrl + A, luego tecla K.
```