# Guía: Habilitar Internet Temporalmente

Si necesitas conectar la tablet a internet temporalmente (para descargar actualizaciones, instalar paquetes, etc.) y actualmente tienes configurada una IP Estática sin salida a internet, sigue estos pasos.

## Paso 1: Configurar Red WiFi con Internet

Edita el archivo de configuración de redes:

```bash
vi /etc/wpa_supplicant/wpa_multi.conf
```

Añade tu red WiFi con internet **al principio del archivo** y dale una prioridad alta (ej. 100):

```text
network={
    ssid="NOMBRE_DE_TU_COREO"
    psk="CONTRASEÑA_WIFI"
    priority=100
    id_str="internet_temp"
}
```

Guarda con `Ctrl+O`, `Enter` y sal con `Ctrl+X`.

## Paso 2: Desactivar IP Estática (Activar DHCP)

Edita el script de conexión:

```bash
vi /usr/local/bin/wifi-connect.sh
```

Busca las líneas de configuración IP. Debes **comentar** (poner `#`) la línea de IP estática y **descomentar** (quitar `#`) la línea de `dhclient`.

Debe quedar algo así:

```bash
# ... (código anterior)

# IP Estática (COMENTAR ESTA LÍNEA)
# ip addr add 192.168.1.55/24 dev wlan0

# DHCP (DESCOMENTAR ESTA LÍNEA O AGREGAR SI NO EXISTE)
dhclient -v wlan0
```

Guarda y sal.

## Paso 3: Aplicar Cambios

Reinicia el servicio de conexión para que tome la nueva red y configuración IP:

```bash
systemctl restart wifi-autoconnect
```

Si no ves una IP asignada, ejecuta manualmente:
```bash
dhclient -v wlan0
```

Verifica que tengas internet:
```bash
ping google.com
```

---

# Restaurar Configuración Original

Cuando termines y quieras volver a la IP Estática y bloquear internet:

1.  Borra la red temporal de `/etc/wpa_supplicant/wpa_multi.conf`.
2.  Edita `/usr/local/bin/wifi-connect.sh`:
    *   Descomenta `ip addr add ...`
    *   Comenta `dhclient ...`
3.  Reinicia el servicio: `systemctl restart wifi-autoconnect`.
