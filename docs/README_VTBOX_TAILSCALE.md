================================================================================
GUÍA DE INSTALACIÓN PERSISTENTE DE TAILSCALE EN VTBOX (YOCTO/ARM64)
================================================================================

DESCRIPCIÓN:
Método de instalación "Side-load" utilizando un servidor HTTP local para evitar 
errores de SSL/TLS con el wget antiguo del dispositivo. Incluye configuración 
de persistencia para que la identidad no se pierda al reiniciar.

REQUISITOS PREVIOS:
1. Conexión de red entre tu PC y el VTBOX (misma WiFi o Ethernet).
2. Tener Python instalado en tu PC.
3. Conocer la IP local de tu PC (ej. ipconfig/ifconfig).

--------------------------------------------------------------------------------
PASO 1: PREPARACIÓN DEL SISTEMA (EN VTBOX)
--------------------------------------------------------------------------------
# Desbloquear sistema de archivos para escritura
umount /etc/ -l
mount -o remount rw /

# Crear directorios de trabajo
mkdir -p /mnt/storage/tailscale_install

--------------------------------------------------------------------------------
PASO 2: TRANSFERENCIA DE ARCHIVOS (PC -> VTBOX)
--------------------------------------------------------------------------------

[EN TU PC / WINDOWS]
1. Descarga el binario: https://pkgs.tailscale.com/stable/tailscale_1.56.1_arm64.tgz
2. Abre una terminal en la carpeta de la descarga.
3. Inicia el servidor temporal:
   python -m http.server 8000

[EN EL VTBOX]
# Entrar a la carpeta temporal
cd /mnt/storage/tailscale_install

# Descargar desde tu PC (REEMPLAZA <TU_IP_PC> con la IP de tu computadora)
# Ejemplo: wget http://192.168.1.50:8000/tailscale_1.56.1_arm64.tgz

--------------------------------------------------------------------------------
PASO 3: INSTALACIÓN DE BINARIOS
--------------------------------------------------------------------------------
# Descomprimir
tar xzf tailscale_1.56.1_arm64.tgz

# Crear carpeta de binarios persistente
mkdir -p /mnt/storage/bin

# Mover ejecutables
cp tailscale_1.56.1_arm64/tailscale /mnt/storage/bin/
cp tailscale_1.56.1_arm64/tailscaled /mnt/storage/bin/

# Dar permisos de ejecución
chmod +x /mnt/storage/bin/tailscale
chmod +x /mnt/storage/bin/tailscaled

# Crear enlaces simbólicos (Symlinks) al sistema
ln -sf /mnt/storage/bin/tailscale /usr/bin/tailscale
ln -sf /mnt/storage/bin/tailscaled /usr/sbin/tailscaled

--------------------------------------------------------------------------------
PASO 4: CONFIGURACIÓN DE PERSISTENCIA Y SERVICIO
--------------------------------------------------------------------------------
# Crear carpeta para guardar la identidad (Login)
mkdir -p /mnt/storage/tailscale_state

# Crear el servicio Systemd optimizado para Yocto
```
cat > /etc/systemd/system/tailscaled.service << 'EOF'
[Unit]
Description=Tailscale node agent
Documentation=https://tailscale.com/kb/
After=network.target mnt-storage.service
Requires=mnt-storage.service

[Service]
# CONFIGURACIÓN VITAL:
# --state: Guarda la sesión en disco físico (/mnt/storage)
# --socket: Define ruta estándar del socket
ExecStart=/usr/sbin/tailscaled --state=/mnt/storage/tailscale_state/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock --port=41641

# Reinicio automático
Restart=on-failure
RestartSec=5s

# Rutas temporales
RuntimeDirectory=tailscale
RuntimeDirectoryMode=0755
StateDirectory=tailscale
StateDirectoryMode=0700
CacheDirectory=tailscale
CacheDirectoryMode=0750
Type=simple

[Install]
WantedBy=multi-user.target
EOF
```
--------------------------------------------------------------------------------
PASO 5: ACTIVACIÓN Y ARRANQUE
--------------------------------------------------------------------------------
# Recargar demonio de servicios
systemctl daemon-reload

# Habilitar servicio al inicio
systemctl enable tailscaled

# Forzar escritura en disco (Vital para no perder cambios)
sync
sync

# Iniciar servicio ahora
systemctl start tailscaled

<!-- # Verificar estado (Debe decir 'Active: active (running)')
systemctl status tailscaled -->

--------------------------------------------------------------------------------
PASO 6: CONEXIÓN Y ACCESO FINAL
--------------------------------------------------------------------------------
# 1. Loguear dispositivo (Copia el link que genere y ábrelo en tu PC)
tailscale up

# 2. Verificar IP asignada
tailscale ip

# 3. ABRIR FIREWALL (Obligatorio para que entre el SSH)
iptables -I INPUT -i tailscale0 -j ACCEPT

# 4. Activar SSH gestionado por Tailscale (Magic SSH)
tailscale up --ssh