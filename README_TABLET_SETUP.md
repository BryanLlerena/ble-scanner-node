# Guía de Configuración General: Tablet Debian

Esta guía describe los pasos para configurar un servicio robusto que conecta automáticamente a redes WiFi basándose en prioridad y mantiene la conexión activa.

**Requisitos:** Acceso como `root` en la terminal.

## Paso 1: Crear archivo de configuración de redes

Este archivo almacena tus redes y sus prioridades. `autoscan` asegura que el dispositivo busque redes activamente si se desconecta.

Ejecuta el siguiente bloque de comando en la terminal:

```bash
cat << 'EOF' > /etc/wpa_supplicant/wpa_multi.conf
ctrl_interface=/var/run/wpa_supplicant
update_config=1
# Escaneo periódico cada 10 segundos si no hay conexión
autoscan=periodic:10

# RED 1: Alta Prioridad
network={
    ssid="UNDIS_FMS_EP"
    psk="%elporvenir123%"
    priority=10
    id_str="principal"
}

# RED 2: Respaldo
network={
    ssid="brll-ryu"
    psk="12345678"
    priority=5
    id_str="respaldo"
}

# RED 1: Alta Prioridad
network={
    ssid="GUNJOPERS"
    psk="Gunjop2023"
    priority=5
    id_str="respaldo"
}

EOF
```

## Paso 2: Crear el script de conexión

Este script limpia conflictos y lanza el gestor de conexión.

Ejecuta:

```bash
cat << 'EOF' > /usr/local/bin/wifi-connect.sh
#!/bin/bash

# 1. Desbloquear WiFi por si acaso
rfkill unblock wifi
rfkill unblock all

# 2. Limpiar procesos conflictivos previos
killall wpa_supplicant 2> /dev/null
killall dhclient 2> /dev/null

# 3. Levantar interfaz fisica
ip link set wlan0 up
sleep 2

# 4. Iniciar wpa_supplicant en background
# Usamos drivers genéricos (nl80211,wext) para asegurar compatibilidad
wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_multi.conf -D nl80211,wext

# 5. Obtener dirección IP
sleep 5
dhclient -v wlan0
EOF
```

Haz el script ejecutable:

```bash
chmod +x /usr/local/bin/wifi-connect.sh
```

## Paso 3: Crear el Servicio de Sistema (Systemd)

Esto asegura que el script se ejecute automáticamente en cada reinicio.

Ejecuta:

```bash
cat << 'EOF' > /etc/systemd/system/wifi-autoconnect.service
[Unit]
Description=Auto-conexion WiFi Multi-Red con Prioridad
After=network.target
Conflicts=NetworkManager.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/wifi-connect.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
```

## Paso 4: Activar y Probar

Finalmente, deshabilita el gestor de red predeterminado (para evitar conflictos) y activa tu nuevo servicio.

```bash
systemctl stop NetworkManager
systemctl disable NetworkManager
systemctl enable wifi-autoconnect
systemctl start wifi-autoconnect
```

## Verificación Final

### 1. Comprobar Conexión a Internet
Para comprobar que tienes salida a internet:
```bash
ping -c 4 google.com
```

### 2. Verificar tu Dirección IP
Para ver qué dirección IP se te ha asignado en la interfaz WiFi (`wlan0`):
```bash
ip addr show wlan0
```
*Busca la línea que dice `inet`, por ejemplo: `inet 192.168.1.45/24`.*

Si ves esa línea con una IP, ¡felicidades! Tu servicio de autoconexión está funcionando perfectamente.

## Configuración de Contraseñas

### Cambiar contraseña de ROOT
Para establecer la contraseña manualmente usa el comando estándar:

```bash
passwd root
gunjop123
```
Luego el sistema te pedirá la contraseña dos veces. Escribe: `gunjop123`

### Habilitar Acceso SSH para Root
Por defecto, Debian bloquea el acceso directo a root por SSH. Para habilitarlo:

1. Edita la configuración de SSH con `vi`:
```bash
vi /etc/ssh/sshd_config
```

2. Busca la línea `PermitRootLogin` (puedes usar `/PermitRoot` para buscar).
3. Presiona `i` para entrar en modo inserción.
4. Cambia la línea para que quede así (asegurate de borrar el `#` al inicio si existe):
```text
PermitRootLogin yes
```

5. Busca también `PasswordAuthentication` y asegúrate de que esté en `yes`:
```text
PasswordAuthentication yes
```

6. Presiona `Esc`, escribe `:wq` y presiona `Enter` para guardar y salir.

7. Reinicia el servicio SSH:
```bash
/etc/init.d/ssh restart
```

---

# Marcobre VT-BOX Configuration Guide (Adaptado)

Esta sección cubre la configuración avanzada para persistencia de datos y entorno Node.js, adaptada para la partición `/dev/mmcblk2p3` (50GB).

**Requisitos:** Acceso Root.

## Paso 1: Sistema y Formateo de Disco

⚠️ **ADVERTENCIA**: Esto borrará todos los datos en la partición 3 (`/dev/mmcblk2p3`).

```bash
# 1. Desmontar /etc por si acaso
umount /etc/ -l
mount -o remount rw /

# 2. Formatear la partición de 50GB
mkfs.ext4 -F /dev/mmcblk2p3
```



## Paso 2: Servicio de Montaje Persistente (mnt-storage)

Crear un servicio para montar automáticamente el almacenamiento en `/mnt/storage`.

```bash
# 1. Crear el servicio de sistema
cat > /etc/systemd/system/mnt-storage.service << 'EOF'
[Unit]
Description=Mount mmcblk2p3 to /mnt/storage
After=local-fs.target systemd-tmpfiles-setup.service
Requires=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes

# 1. Crear carpeta
ExecStartPre=/bin/mkdir -p /mnt/storage

# 2. Limpieza previa
ExecStartPre=-/bin/umount /mnt/storage

# 3. Montar disco (Partición Correcta: mmcblk2p3)
ExecStart=/bin/mount -t ext4 /dev/mmcblk2p3 /mnt/storage

# 4. Limpiar SD Card (opcional)
ExecStartPost=-/bin/umount -l /mnt/sdcard

# Desmontar al apagar
ExecStop=/bin/umount /mnt/storage

[Install]
WantedBy=multi-user.target
EOF

# Habilitar y arrancar el servicio
systemctl daemon-reload
systemctl enable mnt-storage.service
systemctl start mnt-storage.service
```

## Paso 3: Instalación de Node.js (v22.21.1)

```bash
# 1. Crear directorios para aislamiento
cd /mnt/storage
mkdir -p /mnt/storage/.npm
mkdir -p /mnt/storage/.pm2

# 2. Descargar binarios
wget --no-check-certificate https://nodejs.org/dist/v22.21.1/node-v22.21.1-linux-arm64.tar.xz -P /tmp

# 3. Descomprimir e instalar
cd /mnt/storage
tar -xf /tmp/node-v22.21.1-linux-arm64.tar.xz
mv node-v22.21.1-linux-arm64 nodejs

# 4. Limpieza
rm /tmp/node-v22.21.1-linux-arm64.tar.xz
```

## Paso 4: Configuración del Entorno Systema

```bash
# 1. Enlaces Simbólicos
ln -sf /mnt/storage/nodejs/bin/node /usr/bin/node
ln -sf /mnt/storage/nodejs/bin/npm /usr/bin/npm
ln -sf /mnt/storage/nodejs/bin/npx /usr/bin/npx

# 2. Hacer persistentes las variables de entorno
echo 'export PATH="/mnt/storage/nodejs/bin:$PATH"' >> /etc/profile
echo 'export PM2_HOME="/mnt/storage/.pm2"' >> /etc/profile

# 3. Exportar variables para la sesión actual
export PATH="/mnt/storage/nodejs/bin:$PATH"
export PM2_HOME="/mnt/storage/.pm2"

# 4. Configurar cache de NPM en storage
npm config set cache /mnt/storage/.npm --global

# 5. Verificar versiones
node --version
npm --version
```

## Paso 5: Instalar PM2 y Desplegar Aplicación

```bash
# 1. Instalar PM2 globalmente
npm install -g pm2
ln -sf /mnt/storage/nodejs/bin/pm2 /usr/bin/pm2

# 2. Configurar arranque automático de PM2
pm2 startup
# (Sigue las instrucciones que te dé el comando si pide ejecutar algo más)

# 3. Desplegar Aplicación
mkdir -p /mnt/storage/www
cd /mnt/storage/www

git clone https://github.com/BryanLlerena/ble-scanner-node.git
cd ble-scanner-node

# Instalar dependencias
npm install

# Crear .env
vi .env

#Presionar i
#pegar 
    # Rango de escaneo en metros (solo detectar beacons dentro de este rango)
    SCAN_RANGE=10

    # Tiempo de gracia en segundos antes de cerrar un evento (debounce)
    DEBOUNCE_TIME=60

    # Tiempo máximo sin detectar un beacon antes de cerrar automáticamente su evento (en segundos)
    BEACON_TIMEOUT=300

    # Prefijo MAC de los beacons a procesar (solo estos serán guardados)
    TARGET_MAC_PREFIX=bc:57:29

    # Identificador de la unidad/dispositivo scanner
    UNIT=TEST_UNIT

    # Configuración de API
    API_BASE_URL=http://172.236.110.18:3001/api/v1

    # Configuración de sincronización
    SYNC_INTERVAL=30000
    INITIAL_SYNC_DELAY=10000
    SKIP_INTERNET_CHECK=false

    # Configuración de base de datos
    DB_FILE=beacons.db

    # Configuración del servidor web
    WEB_PORT=3000

    # Configuración de logging (opcional)
    LOG_LEVEL=info
    NODE_ENV=production

    # Variables para MQTT y WiFi
    MQTT_COMPANY=gunjop
    MQTT_BROKER=mqtt://localhost:1883
    MQTT_USERNAME=porvenir
    MQTT_PASSWORD=porvenir123
    MQTT_INTERVAL=60000
    WIFI_PORT=3030
    WIFI_DB_FILE=wifi_status.db

#presioanr esc dos veces

# 4. Iniciar con PM2
# Para levantar TODO (Scanner + Web + Sync):
pm2 start ecosystem.config.js

# O si solo quieres levantar la WEB por separado:
# pm2 start web-viewer.js --name web-viewer

# 5. Guardar lista de procesos (CRÍTICO para persistencia)
pm2 save

# 6. Verificar estado
pm2 status
```

## Paso 6: Configuración de Bluetooth (Noble)

Para que la librería `@abandonware/noble` funcione correctamente, necesitamos instalar dependencias del sistema y otorgar permisos a Node.js para acceder al Bluetooth sin ser root (o para asegurar el acceso correcto).

### 1. Instalar dependencias de Bluetooth
```bash
apt-get update
apt-get install -y bluetooth bluez libbluetooth-dev libudev-dev
```

### 2. Otorgar permisos a Node.js
Esto permite que Node.js acceda directamente al adaptador Bluetooth.
```bash
setcap cap_net_raw+eip $(eval readlink -f `which node`)
```

### 3. Verificar con Script de Prueba
Usa el archivo `test-noble.js` que se encuentra en la raíz del proyecto para confirmar que el adaptador es detectado:
```bash
cd /mnt/storage/www/ble-scanner-node
node test-noble.js
```
*Si ves "Estado del adaptador: poweredOn", la configuración es correcta.*

---

## Paso 7: Modo Kiosk con Chromium (Opcional)

Si quieres que la Tablet abra automáticamente la web al encenderse, configuraremos un servicio para Chromium en modo Kiosk.

### 1. Instalar Chromium
```bash
# apt-get update
# apt-get install -y chromium
```

### 2. Crear el servicio de Kiosk
Como estamos trabajando como root, necesitamos flags especiales para que Chromium permita la ejecución.

```bash
cat > /etc/systemd/system/chromium-kiosk.service << 'EOF'
[Unit]
Description=Chromium Kiosk Mode
After=display-manager.service network.target mnt-storage.service
Wants=display-manager.service

[Service]
Type=simple
User=root
# Ajustamos DISPLAY según el sistema (normalmente :0)
Environment=DISPLAY=:0
Environment=XAUTHORITY=/root/.Xauthority

# Flags de Chromium:
# --kiosk: Pantalla completa sin barras
# --no-sandbox: Obligatorio para correr como root
# --disable-infobars: Quitar avisos de actualización
# --user-data-dir: Carpeta de perfil persistente en storage
ExecStart=/usr/bin/chromium \
  --kiosk \
  --no-sandbox \
  --window-position=0,0 \
  --window-size=1280,800 \
  --disable-infobars \
  --user-data-dir=/mnt/storage/chromium-profile \
  http://localhost:3001

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

### 3. Activar y Probar
```bash
# Crear directorio para el perfil
mkdir -p /mnt/storage/chromium-profile

# Activar servicio
systemctl daemon-reload
systemctl enable chromium-kiosk.service
systemctl start chromium-kiosk.service
```

> [!NOTE]
> Si la pantalla se queda negra o no abre, verifica con `echo $DISPLAY` en tu terminal local (no SSH) cuál es el ID de pantalla correcto y ajusta el servicio si es necesario (ej. `:1`).

---

## Mantenimiento y Control de Procesos

Si necesitas detener o reiniciar los servicios manualmente, usa estos comandos:

<!-- ### 1. Controlar la Aplicación (PM2)
```bash
# Ver estado de todo
pm2 status

# Detener todo (Scanner, Web, Sync)
pm2 stop all

# Reiniciar todo
pm2 restart all

# Detener solo uno por nombre
pm2 stop web-viewer
pm2 stop ble-scanner
```

### 2. Controlar la Pantalla (Chromium Kiosk)
```bash
# Detener el Modo Kiosk (Cerrará la ventana en la tablet)
systemctl stop chromium-kiosk.service

# Iniciar el Modo Kiosk
systemctl start chromium-kiosk.service

# Reiniciar el Modo Kiosk
systemctl restart chromium-kiosk.service

# Ver logs de error si no abre
journalctl -u chromium-kiosk.service -f -->
```

### 3. Desactivar arranque automático (Permanentemente)
Si quieres que dejen de iniciar al encender la tablet:
```bash
# Para Chromium
systemctl disable chromium-kiosk.service

# Para el montaje de disco
systemctl disable mnt-storage.service

# Para PM2
pm2 unstartup
```

---

## Solución de Problemas (Troubleshooting)

### Tengo IP pero no hay internet (Ping falla)
Si `ip addr show wlan0` muestra una IP pero no puedes hacer ping al router o a Google, reinicia el servicio de autoconexión para limpiar la tabla de rutas y renegociar el cifrado:
```bash
systemctl restart wifi-autoconnect
```

### Error de compilación en sqlite3 (npm install)
Si falla por **timeout** al descargar headers:
1. Asegúrate de tener internet (`ping google.com`).
2. Aumenta el tiempo de espera de npm:
   `npm config set fetch-retry-mintimeout 20000 && npm config set fetch-retry-maxtimeout 120000`
3. Instala herramientas de compilación:
   `apt-get update && apt-get install -y build-essential`

---

## Configuración Especial: App Porvenir (Puerto 3001)

Si deseas ejecutar la aplicación `app-porvenir` (ubicada en la carpeta adyacente) y visualizarla en el Chromium:

### 1. Desplegar App Porvenir con PM2
La aplicación se encuentra en `/mnt/storage/www/app-porvenir` y su build es `dist/index.js`.

```bash
# Navegar a la carpeta
cd /mnt/storage/www/

# Clonar el repositorio
git clone https://github.com/GUNJOP-PERU/app-porvenir.git

# Navegar a la carpeta de la app
cd /mnt/storage/www/app-porvenir

# Instalar dependencias (si es necesario)
npm install

# Crear .env
vi .env

#Presionar i
#pegar 
    VITE_APP_API_URL=http://172.235.137.146:3001/api/v1
    VITE_MQTT_URL="ws://paranoid.lat:8093/mqtt"
    VITE_MQTT_USERNAME="nexa.gunjop.tablets"
    VITE_MQTT_PASSWORD="*C8wjJr9jK5fJ1&UL4h2VY5"
#presioanr esc dos veces
#luego guardar esribiendo :wq

# Build del proyecto
npm run build

# Iniciar la aplicación en el puerto 3001
# Usamos 'pm2 serve' para servir archivos estáticos (HTML/JS/CSS)
pm2 serve dist 3001 --name app-porvenir

# Guardar cambios
pm2 save
```

### 2. Modificar Chromium para visualizar Puerto 3001
Si quieres que el modo Kiosk apunte a esta nueva aplicación, actualiza el servicio de Chromium:

```bash
# Editar el servicio
# vi /etc/systemd/system/chromium-kiosk.service
# ```

# Cambia la línea `http://localhost:3000` por `http://localhost:3001`:

# ```ini
# # ... dentro de /etc/systemd/system/chromium-kiosk.service
# ExecStart=/usr/bin/chromium \
#   --kiosk \
#   --no-sandbox \
#   --window-position=0,0 \
#   --window-size=1280,800 \
#   --disable-infobars \
#   --user-data-dir=/mnt/storage/chromium-profile \
#   http://localhost:3001
```

### 3. Reiniciar Servicios
```bash
systemctl daemon-reload
systemctl restart chromium-kiosk.service
```

---

## Paso 8: Configuración de Tailscale (Acceso Remoto)

Tailscale te permite acceder a la tablet de forma segura desde cualquier lugar sin configurar VPNs complejas o abrir puertos en el router.

### 1. (Opcional) Solución de errores en repositorios (APT Fix)
Si al intentar instalar Tailscale recibes un error tipo `404 Not Found` en repositorios como `bullseye-backports`, ejecuta estos comandos para limpiar la configuración:

```bash
# Deshabilitar repositorios de backports que suelen fallar
sed -i 's/^deb.*bullseye-backports/# &/' /etc/apt/sources.list

# Limpiar y actualizar la lista de paquetes
apt-get clean
apt-get update
```

### 2. Instalación rápida
Ejecuta el script oficial de instalación:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

### 3. Iniciar y Vincular con SSH (Recomendado)
Para poder entrar a la terminal incluso desde el navegador, activa Tailscale con el flag de SSH:
```bash
tailscale up --ssh
```
*Copia el enlace que aparece, inicia sesión y la tablet quedará registrada con la terminal web habilitada.*

### 4. Acceder por Nombre (MagicDNS)
No necesitas recordar la IP. Gracias a **MagicDNS**, puedes acceder a la tablet usando su nombre (hostname) desde cualquier otro dispositivo donde también tengas Tailscale iniciado:

- **Para ver el nombre de tu tablet:**
  ```bash
  hostname
  ```
- **Ejemplo de acceso por terminal (PC):**
  Si el hostname es `deb-tablet`, puedes entrar por SSH así:
  - SSH: `ssh root@deb-tablet`

### 5. Verificar y Terminal Web
Entra en [login.tailscale.com](https://login.tailscale.com) para gestionar tus dispositivos.

- **Para usar la Terminal desde el Navegador:**
  1. Busca tu tablet en la lista.
  2. Haz clic en los tres puntos **(...)** al final de la fila.
  3. Selecciona **"SSH into machine..."**.
  4. Se abrirá una terminal directamente en tu navegador. ¡Ya estás dentro!

---

## Cómo conectarte a la Tablet desde tu PC (Windows/Mac/Linux)

Tienes dos formas principales de entrar a la terminal de la tablet remotamente:

### Opción A: Desde tu Navegador (Sin instalar nada en tu PC)
1. Entra a tu panel de Tailscale: [login.tailscale.com](https://login.tailscale.com).
2. En tu tablet, haz clic en el botón de los tres puntos `...` y elige **SSH into machine**.
3. ¡Listo! Tendrás una terminal funcional en una pestaña del navegador.

### Opción B: Desde la Terminal de tu PC (Más rápido y potente)
1. **Instala Tailscale en tu PC**: Descárgalo en [tailscale.com/download](https://tailscale.com/download) e inicia sesión.
2. **Abre PowerShell (Windows) o Terminal (Mac/Linux)**.
3. **Ejecuta el SSH**:
   ```bash
   ssh root@nombre-tablet  # O usa la IP de Tailscale
   ```
4. **Contraseña**: Introduce `gunjop123`.

¡Listo! Ya tienes control total de la tablet de forma remota.
