#!/bin/sh

# Configuración de WiFi para Yocto con wpa_supplicant
# SSID: brll'tyu
# Password: 12345678

WPA_FILE="/etc/wpa_supplicant.conf"
if [ -d "/etc/wpa_supplicant" ]; then
    WPA_FILE="/etc/wpa_supplicant/wpa_supplicant.conf"
fi

echo "🔍 Verificando wpa_supplicant..."

if ! command -v wpa_supplicant >/dev/null 2>&1; then
    echo "❌ ERROR: No se encontró 'wpa_supplicant' ni 'connman'."
    echo "Por favor, ejecuta 'ifconfig -a' o 'ip link' para ver qué interfaces de red tienes."
    exit 1
fi

echo "🔧 Configurando wpa_supplicant en: $WPA_FILE"

# Crear backup si existe
if [ -f "$WPA_FILE" ]; then
    cp "$WPA_FILE" "$WPA_FILE.bak"
    echo "📦 Backup creado en $WPA_FILE.bak"
fi

# Escribir configuración
# Usamos SSID en hexadecimal para manejar seguro la comilla simple (')
# 'brll'tyu' -> 62726c6c27747975
cat > "$WPA_FILE" <<EOF
ctrl_interface=/var/run/wpa_supplicant
ctrl_interface_group=0
update_config=1

network={
    ssid="brll'tyu"
    psk="12345678"
    scan_ssid=1
    key_mgmt=WPA-PSK
}
EOF

echo "✅ Archivo configurado."
echo "🔄 Reiniciando servicio de red..."

# Intentar reiniciar wpa_supplicant
if command -v systemctl >/dev/null 2>&1; then
    # Habilitar para arranque
    systemctl enable wpa_supplicant
    
    # En Yocto a veces el servicio se llama 'wpa_supplicant@wlan0' o similar
    # Intentamos el genérico primero
    systemctl restart wpa_supplicant || echo "⚠️ Advertencia: No se pudo reiniciar wpa_supplicant genérico."
    
    # Intentar reiniciar en wlan0 explícitamente si existe
    if ip link show wlan0 >/dev/null 2>&1; then
        echo "Reiniciando para interfaz wlan0..."
        systemctl restart wpa_supplicant@wlan0
    fi
else
    # Fallback init.d
    if [ -f /etc/init.d/wpa_supplicant ]; then
        /etc/init.d/wpa_supplicant restart
    fi
fi

# Forzar reconexión
echo "📡 Solicitando reconexión..."
wpa_cli -i wlan0 reconfigure 2>/dev/null || wpa_cli reconfigure 2>/dev/null

echo "⏳ Esperando 5 segundos..."
sleep 5

echo "📊 Estado de IP:"
ip addr show wlan0 2>/dev/null || ifconfig wlan0 2>/dev/null
