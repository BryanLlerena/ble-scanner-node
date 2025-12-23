# Instalación del Servicio WiFi Auto-connect

Este servicio habilita automáticamente la interfaz WiFi y se conecta a la red configurada cada vez que el dispositivo Yocto inicia.

## 📋 Requisitos Previos

1. Ya debes tener configurado `/etc/wpa_supplicant.conf` con tu red WiFi
2. El sistema debe usar `systemd` como gestor de servicios

## 🚀 Instalación

### Paso 1: Transferir archivos al dispositivo

Desde tu PC, transfiere los archivos al dispositivo Yocto:

```bash
# Opción A: Usando SCP
scp wifi-autoconnect.sh root@<IP_DISPOSITIVO>:/tmp/
scp wifi-autoconnect.service root@<IP_DISPOSITIVO>:/tmp/

# Opción B: Usando USB o método manual
# Copia los archivos a una USB y móntala en el dispositivo
```

### Paso 2: Instalar en el dispositivo

Conéctate al dispositivo Yocto y ejecuta:

```bash
# 1. Copiar el script al directorio de binarios
cp /tmp/wifi-autoconnect.sh /usr/local/bin/
chmod +x /usr/local/bin/wifi-autoconnect.sh

# 2. Copiar el servicio systemd
cp /tmp/wifi-autoconnect.service /etc/systemd/system/

# 3. Recargar systemd
systemctl daemon-reload

# 4. Habilitar el servicio para que inicie automáticamente
systemctl enable wifi-autoconnect.service

# 5. Iniciar el servicio ahora (opcional, para probar)
systemctl start wifi-autoconnect.service
```

## ✅ Verificación

### Verificar estado del servicio

```bash
systemctl status wifi-autoconnect.service
```

Deberías ver algo como:
```
● wifi-autoconnect.service - WiFi Auto-connect Service
   Loaded: loaded (/etc/systemd/system/wifi-autoconnect.service; enabled)
   Active: active (exited) since ...
```

### Verificar logs

```bash
# Ver logs del servicio
journalctl -u wifi-autoconnect.service

# Ver logs en tiempo real
journalctl -u wifi-autoconnect.service -f
```

### Verificar conexión WiFi

```bash
# Ver estado de wpa_supplicant
wpa_cli -i wlan0 status

# Ver dirección IP
ip addr show wlan0
```

## 🔄 Probar el servicio

Para verificar que funciona correctamente al reiniciar:

```bash
# Reiniciar el dispositivo
reboot

# Después del reinicio, verificar que se conectó automáticamente
ip addr show wlan0
```

## 🛠️ Comandos útiles

```bash
# Detener el servicio
systemctl stop wifi-autoconnect.service

# Reiniciar el servicio
systemctl restart wifi-autoconnect.service

# Deshabilitar el servicio (no iniciará automáticamente)
systemctl disable wifi-autoconnect.service

# Ver logs completos
journalctl -u wifi-autoconnect.service --no-pager
```

## 🐛 Solución de problemas

### El servicio falla al iniciar

```bash
# Ver errores específicos
journalctl -u wifi-autoconnect.service -n 50

# Verificar que el script tiene permisos de ejecución
ls -l /usr/local/bin/wifi-autoconnect.sh

# Ejecutar el script manualmente para ver errores
/usr/local/bin/wifi-autoconnect.sh
```

### No se conecta a la red

```bash
# Verificar configuración de wpa_supplicant
cat /etc/wpa_supplicant.conf

# Probar conexión manual
wpa_cli -i wlan0 reconfigure
wpa_cli -i wlan0 status
```

### La interfaz wlan0 no existe

Si tu interfaz WiFi tiene otro nombre (ej: `wlp2s0`), edita el script:

```bash
nano /usr/local/bin/wifi-autoconnect.sh
# Cambia INTERFACE="wlan0" por el nombre correcto
```

## 📝 Notas

- El servicio espera hasta 30 segundos (10 intentos × 3 segundos) para conectarse
- Los logs se guardan en el journal del sistema
- El servicio se ejecuta antes de que la red esté completamente disponible para asegurar conectividad temprana
