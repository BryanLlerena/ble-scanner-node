#!/bin/sh

# WiFi Auto-connect Script para Yocto
# Este script habilita la interfaz WiFi y se conecta a la red configurada

INTERFACE="wlan0"
MAX_RETRIES=20
RETRY_DELAY=3

log_msg() {
    echo "[WiFi-Autoconnect] $1"
    logger -t wifi-autoconnect "$1"
}

log_msg "Iniciando servicio de auto-conexión WiFi..."

# 1. Verificar que la interfaz existe
if ! ip link show "$INTERFACE" >/dev/null 2>&1; then
    log_msg "ERROR: Interfaz $INTERFACE no encontrada"
    exit 1
fi

# 2. Habilitar la interfaz
log_msg "Habilitando interfaz $INTERFACE..."
ip link set "$INTERFACE" up
sleep 2

# 3. Verificar que wpa_supplicant está configurado
WPA_CONF="/etc/wpa_supplicant/wpa_supplicant.conf"
if [ ! -f "$WPA_CONF" ]; then
    WPA_CONF="/etc/wpa_supplicant.conf"
fi

if [ ! -f "$WPA_CONF" ]; then
    log_msg "ERROR: No se encontró archivo de configuración wpa_supplicant"
    exit 1
fi

# 4. Iniciar wpa_supplicant si no está corriendo
if ! pgrep -x wpa_supplicant >/dev/null; then
    log_msg "Iniciando wpa_supplicant..."
    wpa_supplicant -B -i "$INTERFACE" -c "$WPA_CONF" -P /var/run/wpa_supplicant.pid
    sleep 3
else
    log_msg "wpa_supplicant ya está corriendo, reconfigurando..."
    wpa_cli -i "$INTERFACE" reconfigure
fi

# 5. Esperar a que se conecte
# 5. Esperar a que se conecte
log_msg "Esperando conexión WiFi..."
RETRY=0
CONNECTED=0

while [ $RETRY -lt $MAX_RETRIES ]; do
    if wpa_cli -i "$INTERFACE" status | grep -q "wpa_state=COMPLETED"; then
        log_msg "✓ Conectado a la red WiFi"
        CONNECTED=1
        break
    fi
    RETRY=$((RETRY + 1))
    log_msg "Intento $RETRY/$MAX_RETRIES... (Estado: $(wpa_cli -i "$INTERFACE" status | grep wpa_state | cut -d= -f2))"
    sleep $RETRY_DELAY
done

if [ $CONNECTED -eq 0 ]; then
    log_msg "ERROR: No se pudo conectar a la red WiFi después de $MAX_RETRIES intentos."
    log_msg "Estado final de wpa_supplicant:"
    wpa_cli -i "$INTERFACE" status | logger -t wifi-autoconnect
    exit 1
fi

# 6. Obtener dirección IP con DHCP
if command -v udhcpc >/dev/null 2>&1; then
    log_msg "Obteniendo dirección IP con udhcpc..."
    # -n: exit if lease fails, -q: quit after obtaining lease
    if ! udhcpc -i "$INTERFACE" -n -q -t 5; then
         log_msg "ERROR: udhcpc falló al obtener IP"
         exit 1
    fi
elif command -v dhclient >/dev/null 2>&1; then
    log_msg "Obteniendo dirección IP con dhclient..."
    if ! dhclient "$INTERFACE"; then
        log_msg "ERROR: dhclient falló"
        exit 1
    fi
else
    log_msg "ADVERTENCIA: No se encontró cliente DHCP (udhcpc/dhclient)"
    exit 1
fi

# 7. Verificar IP asignada
sleep 2
IP_ADDR=$(ip -4 addr show "$INTERFACE" | grep -oP '(?<=inet\s)\d+(\.\d+){3}')
if [ -n "$IP_ADDR" ]; then
    log_msg "✓ IP asignada: $IP_ADDR"
else
    log_msg "ERROR: No se obtuvo dirección IP (verificación final)"
    exit 1
fi

log_msg "Servicio de auto-conexión WiFi completado exitosamente"
exit 0
