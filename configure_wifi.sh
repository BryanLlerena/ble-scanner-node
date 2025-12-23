#!/bin/sh

# Configuración de WiFi para Yocto/ConnMan
# SSID: brll'tyu
# Password: 12345678

CONFIG_DIR="/var/lib/connman"
CONFIG_FILE="$CONFIG_DIR/wifi_auto.config"

# Verificar si ConnMan está instalado
if ! command -v connmanctl >/dev/null 2>&1; then
    echo "⚠️  ADVERTENCIA: 'connmanctl' no encontrado. Este script es para sistemas Yocto con ConnMan."
    echo "Si usas wpa_supplicant, avísame para darte otros comandos."
    exit 1
fi

echo "🔧 Configurando WiFi automático para 'brll'tyu'..."

# Crear directorio si no existe (raro, pero posible)
mkdir -p "$CONFIG_DIR"

# Intentar eliminar config anterior si existe para evitar conflictos
rm -f "$CONFIG_FILE"

# Crear archivo de provisionamiento
# NOTA: ConnMan maneja caracteres especiales en el campo 'Name' correctamente dentro del archivo .config
cat > "$CONFIG_FILE" <<EOF
[global]
Name = AutoConnectProfile
Description = Provisionamiento automatico de WiFi

[service_wifi_auto]
Type = wifi
Name = brll'tyu
Passphrase = 12345678
AutoConnect = true
EOF

echo "✅ Archivo de configuración creado en: $CONFIG_FILE"
echo "🔄 Reiniciando ConnMan para aplicar cambios..."

# Reiniciar servicio (intentar systemd y init.d)
if command -v systemctl >/dev/null 2>&1; then
    systemctl restart connman
else
    /etc/init.d/connman restart
fi

# Esperar unos segundos y verificar estado
sleep 5
echo "📡 Estado de la conexión:"
if command -v connmanctl >/dev/null 2>&1; then
    connmanctl state
fi

echo "🎉 Configuración completada. El dispositivo debería conectarse automáticamente."
