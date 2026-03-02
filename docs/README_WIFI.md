# Configuración de Auto-Conexión WiFi (VT-BOX)

Este documento detalla los pasos para asegurar que el VT-BOX se conecte automáticamente a las redes WiFi configuradas, manejando reconexiones en caso de pérdida de señal y asignación dinámica de IP (DHCP). 

Estos pasos están diseñados para ser ejecutados vía SSH sin perder la conexión durante el proceso de configuración. La conexión solo se reiniciará al final del proceso al reiniciar el equipo.

---

## PASO 1: Desbloquear el Sistema de Archivos

El sistema de archivos raíz en el VT-BOX es de solo lectura por defecto.  Es necesario habilitar la escritura para crear scripts y servicios.

```bash
umount /etc/ -l
mount -o remount rw /
```

## PASO 2: Deshabilitar Servicios Conflictivos

Se deshabilitan servicios anteriores que puedan interferir con nuestro nuevo script unificado. Se usa `disable` en lugar de `stop` para no cortar la conexión SSH actual.

```bash
systemctl disable NetworkManager 2>/dev/null
systemctl disable wifi-watchdog.service 2>/dev/null
```

## PASO 3: Configurar las Redes WiFi

Creamos el archivo de configuración `wpa_supplicant.conf` con las credenciales y prioridades de conexión.
*Nota de funcionalidad:* A **mayor** número en `priority`, **mayor** es la preferencia de la red.

```bash
cat <<EOF > /data/misc/wifi/wpa_supplicant.conf
ctrl_interface=/var/run/wpa_supplicant
ctrl_interface_group=0
update_config=1
autoscan=periodic:10

# RED 1: Principal (Mayor Prioridad)
network={
    ssid="UNDIS_FMS_CL"
    psk="%cerrolindo123%"
    key_mgmt=WPA-PSK
    priority=10
}

# RED 2: Secundaria (Prioridad Media)
network={
    ssid="GUNJOPERS"
    psk="Gunjop2023"
    key_mgmt=WPA-PSK
    priority=5
}

# RED 3: Respaldo (Prioridad Baja)
network={
    ssid="UNDIS_CL"
    psk="%Undis2025%"
    key_mgmt=WPA-PSK
    priority=1
}
EOF

# Aplicar permisos seguros
chmod 600 /data/misc/wifi/wpa_supplicant.conf
```

## PASO 4: Crear el Script de Auto-Conexión (DHCP)

Este script será el encargado de matar procesos huérfanos, iniciar el WiFi bajo su control y vigilar que la conexión y la IP (DHCP) se mantengan activas.

```bash
cat > /usr/local/bin/wifi-connect.sh << 'SCRIPT'
#!/bin/bash
# ==========================================
# Auto WiFi persistente (DHCP) para VT-BOX
# ==========================================
INTERFACE=wlan0

echo 0 > /proc/sys/kernel/printk
#rfkill unblock wifi
#rfkill unblock all
killall wpa_supplicant 2>/dev/null
killall dhclient 2>/dev/null
ip link set $INTERFACE up
sleep 2

# Iniciar wpa_supplicant apuntando a las redes del VT-BOX
wpa_supplicant -B -i $INTERFACE -c /data/misc/wifi/wpa_supplicant.conf -D nl80211,wext
sleep 3

while true; do
    # Consultar estado de la conexión
    STATE=$(wpa_cli -i $INTERFACE status | grep '^wpa_state=' | cut -d= -f2)
    
    if [ "$STATE" == "COMPLETED" ]; then
        # Verificar si la tablet ya recibió una dirección IP automática
        IP=$(ip addr show $INTERFACE | grep "inet " | grep -v "127.0.0.1" | awk '{print $2}')
        if [ -z "$IP" ]; then
            echo "$(date) - Conectado al WiFi pero sin IP. Solicitando DHCP..."
            killall dhclient 2>/dev/null
            dhclient $INTERFACE &
        fi
        sleep 30
    else
        echo "$(date) - WiFi Desconectado (Estado: $STATE). Escaneando..."
        wpa_cli -i $INTERFACE scan
        sleep 10
    fi
done
SCRIPT

# Dar permisos de ejecución
chmod +x /usr/local/bin/wifi-connect.sh
```

## PASO 5: Crear y Habilitar el Servicio SystemD

Creamos un servicio para que el script de auto-conexión inicie automáticamente en cada arranque del equipo.
Se usa `enable` para prepararlo al arranque, pero no `start` para evitar cortes en el SSH actual.

```bash
cat > /etc/systemd/system/wifi-autoconnect.service << 'EOF'
[Unit]
Description=WiFi Auto-conexion DHCP (VT-BOX)
After=sysinit.target

[Service]
Type=simple
ExecStart=/usr/local/bin/wifi-connect.sh
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Recargar daemon y habilitar
systemctl daemon-reload
systemctl enable wifi-autoconnect.service
```

## PASO 6: Guardar y Reiniciar

Escribimos en disco y reiniciamos. Esta es la única acción que te desconectará del SSH temporalmente.

```bash
sync
sync
reboot
```
