# Guía de Configuración de IP Estática (Permanente)

Ejecuta el siguiente bloque de comandos **completo** en tu terminal.

Esto realizará 3 acciones automáticamente:
1.  **Actualizará el archivo** `/usr/local/bin/wifi-connect.sh` con la configuración correcta (IP Estática + Gateway).
2.  **Otorgará permisos** de ejecución.
3.  **Ejecutará el script** para aplicar los cambios inmediatamente.

### Copia y pega todo esto en la terminal:

```bash
# 1. Sobrescribir el script con la configuración correcta (IP .70/23 y Gateway .1)
cat << 'EOF' > /usr/local/bin/wifi-connect.sh
#!/bin/bash

# ==========================================
# Script de Conexión WiFi + IP Estática
# ==========================================

# 1. Desbloquear WiFi y limpiar conflictos
rfkill unblock wifi
rfkill unblock all
killall wpa_supplicant 2> /dev/null
killall dhclient 2> /dev/null

# 2. Levantar interfaz fisica
ip link set wlan0 up
sleep 2

# 3. Conectar al WiFi
# Nota: wpa_supplicant es necesario para autenticarse, aunque usemos IP estática.
wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_multi.conf -D nl80211,wext

# Esperar 5 segundos a que el WiFi se asocie
sleep 5

# 4. Configurar IP Estática y Ruta
echo "Configurando IP Estática..."

# Limpiar configuración previa
ip addr flush dev wlan0

# Asignar IP (172.15.80.70 con máscara /23)
ip addr add 172.15.80.70/23 dev wlan0

# Asignar Puerta de Enlace (.1)
ip route add default via 172.15.80.1

echo "Configuración completada."
EOF

# 2. Hacer ejecutable el script
chmod +x /usr/local/bin/wifi-connect.sh

# 3. Aplicar cambios ahora mismo
/usr/local/bin/wifi-connect.sh

# 4. Verificar configuración
echo "----------------------------------------"
echo "Verificando IP:"
ip addr show wlan0 | grep inet
echo "----------------------------------------"
echo "Verificando Gateway (Ping):"
ping -c 2 172.15.80.1
```
