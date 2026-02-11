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
    ssid="UNDIS_FMS_CL"
    psk="%cerrolindo123%"
    key_mgmt=WPA-PSK
    priority=10
}

# RED 2: brll-ryu (Prioridad Media)
network={
    ssid="brll-ryu"
    psk="12345678"
    key_mgmt=WPA-PSK
    priority=5
}

# RED 3: Respaldo (Prioridad Baja)
network={
    ssid="gunjop"
    psk="12345678"
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

# Nota: Si el comando anterior devuelve "No packages installed or removed", significa que bluez5 ya está instalado.
# Continua con la instalación de herramientas (si faltan).
```

### 2. Verificar Herramientas (hcitool, hciconfig)
Algunas imágenes de Yocto incluyen estas herramientas en paquetes separados o con nombres distintos (ej. `bluez5-noinst-tools`, `bluez-deprecated`).

Verifica si ya las tienes:
```bash
which hcitool
# Si devuelve una ruta (ej: /usr/bin/hcitool), salta al paso 3.
```

Si **no** las tienes, intenta encontrar el paquete correcto:
```bash
opkg list | grep bluez
# Busca paquetes como 'bluez5-noinst-tools', 'bluez-utils', o 'bluez-deprecated' e instálalos:
# opkg install bluez5-noinst-tools
```

### 3. Instalar Librerías de Desarrollo (Opcional)
Si al hacer `npm install` de tu proyecto falla la compilación de noble/bleno:
```bash
opkg install bluez5-dev libglib-2.0-dev udev-dev
```

### 4. Habilitar y Arrancar el Servicio Bluetooth
```bash
# Habilitar servicio
systemctl enable bluetooth
systemctl start bluetooth

# Desbloquear RFKill (importante si no escanea)
rfkill unblock bluetooth
rfkill unblock all

# Levantar interfaz
hciconfig hci0 up
```

### 5. Verificar Escaneo Manual
```bash
hcitool lescan
# Deberías ver dispositivos. Presiona Ctrl+C para salir.
```

### 6. Otorgar Permisos a Node.js (`setcap`)
Para que Node pueda escanear sin ser root:

```bash
# Instalar la herramienta setcap si no existe
# Intento 1: libcap-bin (Debian/Yocto standard)
opkg install libcap-bin

# Intento 2: libcap (Algunas distros)
opkg install libcap

# Intento 3: libcap2-bin (Otra variante común)
opkg install libcap2-bin

# Aplicar permisos (si logras instalar setcap)
setcap cap_net_raw+eip $(eval readlink -f `which node`)

# ⚠️ SI NO PUEDES INSTALAR SETCAP:
# No te preocupes. Como estás ejecutando como ROOT, Node.js tendrá acceso 
# al hardware Bluetooth automáticamente. Puedes saltar este paso.

```

### 7. Verificar con Script de JS
```bash
cd /mnt/storage/www/ble-scanner-node
node test-noble.js
```
*Debería mostrar "Estado del adaptador: poweredOn".*

---

---

## Solución de Problemas (Troubleshooting)

### Error: `noble: Initialization of USB device failed: ENODEV`
- **Causa:** Noble no encuentra ningún adaptador Bluetooth disponible (ni USB ni UART/interno).
- **Solución:**

  1. **Verificar si el sistema detecta el hardware:**
     ```bash
     hciconfig -a
     ```
     * **Si NO sale nada:** El kernel no ve ningún dispositivo Bluetooth.
       - Intenta instalar y revisar `lsusb` (si es USB) o `dmesg | grep -i blue`.
       - Es probable que necesites conectar un **Dongle Bluetooth USB** compatible (ej. CSR 4.0).
       - O falta el firmware en `/lib/firmware`.

  2. **Instalar rfkill (si no existe):**
     tu sistema no tiene `rfkill`. Instálalo:
     ```bash
     opkg install rfkill
     ```
     Luego prueba desbloquear:
     ```bash
     rfkill unblock all
     ```

  3. **Levantar la interfaz (si sale DOWN):**
     ```bash
     hciconfig hci0 up
     ```

### ¿Bluetooth Integrado en el Procesador? (UART)

Si el chip es interno, a menudo está conectado via **UART** (Serial) y no USB. `hciconfig` no lo verá hasta que se "adjunte".

1.  **Instalar herramientas requeridas:**
    ```bash
    opkg install bluez5-noinst-tools
    # O busca 'bluez-uci' o paquetes que contengan 'hciattach'
    ```

### ¿Bluetooth Integrado en el Procesador? (UART Qualcomm/MSM)

Tu log de `dmesg` muestra dispositivos `ttyHS0`, `ttyHS1`, `ttyHS2`. Estos son típicos en procesadores Qualcomm (MSM).

**El error `No such file or directory` indica que `/dev/ttyS1` no existe.**

Prueba con `/dev/ttyHS0`, que suele ser el Bluetooth en estas placas:

1.  **SOLUCIÓN CONFIRMADA (Chip Qualcomm/Rome):**
    Este dispositivo requiere el driver `qca` para descargar el firmware automáticamente.
    
    ```bash
    hciattach /dev/ttyHS0 qca 115200 flow
    ```
    
    *Verás un log largo descargando archivos ("Rampatch TLV file Downloading...").*
    *Si al final dice "Device setup complete", ¡FUNCIONÓ!*

2.  **Levantar la interfaz (CRÍTICO):**
    Una vez descargado el firmware, la interfaz existe pero suele estar PAGADA (DOWN).
    Actívala con:
    ```bash
    hciconfig hci0 up
    hciconfig hci0 piscan
    ```

3.  **Verificar estado:**
    ```bash
    hciconfig -a
    ```
    *Debería decir `UP RUNNING`.*

3.  **Si falla `hciconfig hci0 up` con `Connection timed out (110)`:**
    Esto significa que el puerto está correcto, pero el chip no responde o **falta el firmware**.
    
    a. **Revisa los logs del kernel:**
       ```bash
       dmesg | tail -n 20
       ```
       *(Busca errores como `firmware file not found` o `qca... failed`)*.

    b. **Prueba con el driver específico de Qualcomm (QCA) en lugar de `any`:**
       Primero "mata" el proceso anterior de `hciattach`:
       ```bash
       killall hciattach
       ```
       Luego intenta con `qca`:
       ```bash
       hciattach /dev/ttyHS0 qca 115200 flow
       ```
       *(A veces también prueba subir la velocidad a `3000000` si `115200` falla)*.

    c. **Instalar firmwares faltantes:**
       Si `dmesg` dice que falta un archivo `.nvm` o `.ram`:
       ```bash
       opkg install linux-firmware-qca
       # O busca paquetes de firmware:
       opkg search *firmware*
       ```

3.  **Revisar dmesg para pistas del puerto:**
    ```bash
    dmesg | grep -i tty
    ```


---

---

## Paso 9: Persistencia del Bluetooth (Systemd)

    **Método Robusto (Script Helper):**
    Para evitar problemas de tiempos y rutas, crearemos un script que maneje todo el proceso ordenadamente.

    a. **Crear el script de inicio (VERSIÓN CON RETARDO Y PM2):**
    ```bash
cat > /usr/bin/init-bluetooth.sh << 'EOF'
#!/bin/sh
set -x 
# LOG file en /tmp
LOG=/tmp/bluetooth-init.log
echo "Starting Bluetooth init at $(date). Waiting 30s..." > $LOG

# 0. ESPERA INICIAL (30 segundos para que todo el sistema arranque)
sleep 30

# 1. Limpiar proceso anterior
echo "Killing old hciattach..." >> $LOG
/usr/bin/killall hciattach >> $LOG 2>&1 || true
sleep 1

# 2. Adjuntar el dispositivo (CON RUTA COMPLETA)
echo "Running hciattach..." >> $LOG
/usr/bin/hciattach /dev/ttyHS0 qca 115200 flow >> $LOG 2>&1
RET=$?
echo "hciattach returned code: $RET" >> $LOG

# 3. Esperar a que cargue el firmware
echo "Waiting 5s for firmware..." >> $LOG
sleep 5

# 4. Levantar interfaz
echo "Bringing up hci0..." >> $LOG
/usr/bin/hciconfig hci0 up >> $LOG 2>&1
/usr/bin/hciconfig hci0 piscan >> $LOG 2>&1

# 5. Estado final y REINICIAR PM2
/usr/bin/hciconfig -a >> $LOG 2>&1

echo "Restarting PM2 apps..." >> $LOG
export PM2_HOME="/mnt/storage/.pm2"
/usr/bin/pm2 restart all >> $LOG 2>&1

echo "Finished at $(date)" >> $LOG

    c. **La Solución Definitiva: PM2 como Gatillo + Script Robusto (Hybrid V2):**
    Esta es la arquitectura "a prueba de balas" para tu hardware. Usamos PM2 para encender el servicio de Systemd, y el servicio ejecuta un script robusto que maneja los reintentos.

    **1. Crear el Script Robusto (init-bluetooth.sh):**
    Copia y pega todo este bloque en la terminal:
    ```bash
    cat > /usr/bin/init-bluetooth.sh << 'EOF'
    #!/bin/sh
    LOG=/tmp/bluetooth-init.log
    echo "Starting Bluetooth init via PM2 (v4) at $(date)" > $LOG

    # 1. DESBLOQUEO PREVENTIVO
    echo "Unblocking all radio..." >> $LOG
    /usr/sbin/rfkill unblock all >> $LOG 2>&1
    sleep 1

    # 2. Limpieza
    echo "Cleaning previous instances..." >> $LOG
    killall hciattach > /dev/null 2>&1 || true
    sleep 3

    # 3. Adjuntar
    echo "Running hciattach..." >> $LOG
    /usr/bin/hciattach /dev/ttyHS0 qca 115200 flow >> $LOG 2>&1 &
    ATTACH_PID=$!
    echo "hciattach started with PID $ATTACH_PID" >> $LOG

    # 4. BUCLE DE ESPERA (30s)
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

    # 5. DIAGNÓSTICO
    if [ $COUNT -ge 30 ]; then
        echo "TIMEOUT: hci0 not found via script. Running force UP..." >> $LOG
    fi

    # 6. LEVANTAR INTERFAZ
    /usr/bin/hciconfig hci0 up >> $LOG 2>&1
    /usr/bin/hciconfig hci0 piscan >> $LOG 2>&1
    
    # 7. Verificación
    echo "Final device status:" >> $LOG
    /usr/bin/hciconfig -a >> $LOG 2>&1

    # 8. Reiniciar App PM2
    echo "Restarting PM2 process..." >> $LOG
    export PM2_HOME="/mnt/storage/.pm2"
    /usr/bin/pm2 restart ble-scanner-node >> $LOG 2>&1
    
    echo "Finished at $(date)" >> $LOG
    exit 0
    EOF
    
    # ¡IMPORTANTE! Dar permisos de ejecución:
    chmod +x /usr/bin/init-bluetooth.sh
    ```

    **2. Crear el Servicio de Systemd (Wrapper):**
    Este servicio ejecutará el script anterior.
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
    
    # Recargar Systemd (pero NO habilitar):
    systemctl daemon-reload
    systemctl disable attach-bluetooth.service
    ```

    **3. Crear el Gatillo de PM2:**
    Este script encenderá el servicio en el arranque.
    ```bash
    cat > /usr/bin/start-bluetooth-service.sh << 'EOF'
    #!/bin/sh
    echo "PM2 Trigger: Starting Bluetooth Service..."
    systemctl start attach-bluetooth.service
    echo "Service started!"
    exit 0
    EOF
    
    # Dar permisos:
    chmod +x /usr/bin/start-bluetooth-service.sh
    ```

    **4. Registrar en PM2 (Comando Final):**
    ```bash
    # Si tenías el proceso anterior, bórralo:
    pm2 delete bt-trigger 2>/dev/null || true
    
    # Iniciar el nuevo gatillo:
    pm2 start /usr/bin/start-bluetooth-service.sh --name "bt-trigger" --no-autorestart
    
    # Guardar para persistencia:
    pm2 save
    ```

    **5. Probar:**
    Reinicia (`reboot`). Al volver, PM2 ejecutará el gatillo, este levantará el servicio, y el servicio ejecutará tu script robusto. ¡Listo! 🚀

    **3. Verificar:**
    Reinicia (`reboot`). Al volver, PM2 arrancará `bluetooth-init`, configurará el hardware, y luego reiniciará tu app.
    Revisa el log: `cat /tmp/bluetooth-init.log`.


---

## Conexion Serial (Debug)

Si necesitas acceder por puerto serial (desde Mac):
```bash
screen /dev/cu.PL2303G-USBtoUART1120 115200
# Para salir: Ctrl + A, luego tecla K.
```