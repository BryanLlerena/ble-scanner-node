# Chromium Kiosk Mode Setup en i.MX8MM EVK con Yocto

Este documento describe cómo configurar Chromium para que se ejecute automáticamente en modo kiosko (pantalla completa) al iniciar el sistema en un dispositivo i.MX8MM EVK con Yocto Linux.

---

## 🚀 Instalación Rápida (Comandos Directos)

**Copia y pega estos comandos directamente en el terminal de tu dispositivo Yocto vía SSH:**

```bash
# 1. Crear el servicio systemd
cat > /etc/systemd/system/chromium-kiosk.service << 'EOF'
[Unit]
Description=Chromium Kiosk Mode
After=weston.service multi-user.target
Wants=weston.service

[Service]
Type=simple
User=root
Environment="XDG_RUNTIME_DIR=/run/user/0"
Environment="WAYLAND_DISPLAY=wayland-0"
ExecStartPre=/bin/sleep 15
ExecStart=/bin/sh -c 'while [ ! -S /run/user/0/wayland-0 ]; do sleep 1; done; exec chromium --no-sandbox --disable-gpu --disable-gpu-compositing --kiosk --no-first-run --disable-infobars --disable-session-crashed-bubble --disable-translate https://gunjop.com'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=graphical.target
EOF

# 2. Recargar systemd
systemctl daemon-reload

# 3. Habilitar el servicio para inicio automático
systemctl enable chromium-kiosk.service

# 4. Iniciar el servicio ahora
systemctl start chromium-kiosk.service

# 5. Verificar que está funcionando
sleep 20
systemctl status chromium-kiosk.service
ps aux | grep chromium
```

**¡Listo!** Chromium debería estar mostrando https://gunjop.com en pantalla completa.

Para cambiar la URL, edita el archivo `/etc/systemd/system/chromium-kiosk.service` y cambia `https://gunjop.com` por tu URL deseada, luego ejecuta:

```bash
systemctl daemon-reload
systemctl restart chromium-kiosk.service
```

---

## Resumen

El sistema inicia automáticamente:
1. **Weston** (compositor Wayland) - Proporciona el entorno gráfico
2. **Chromium** en modo kiosko - Muestra una página web específica en pantalla completa

## Requisitos Previos

- i.MX8MM EVK con Yocto Linux instalado
- Weston 9.0.0 instalado y configurado
- Chromium instalado
- Pantalla HDMI conectada (1280x800)
- Touchscreen eGalax (opcional, para interacción)

## Problema Inicial

Al intentar ejecutar Chromium, se encontraron varios errores:

```bash
# Error 1: Wayland no disponible
[ERROR:wayland_connection.cc(127)] Failed to connect to Wayland display
[FATAL:ozone_platform_wayland.cc(173)] Failed to initialize Wayland platform

# Error 2: GPU context failures
[ERROR:gpu_channel_manager.cc(746)] ContextResult::kFatalFailure: Failed to create shared context

# Error 3: Backend GBM no disponible
[FATAL:platform_selection.cc(45)] Invalid ozone platform: gbm
```

## Solución Implementada

### 1. Configuración de Weston

Weston debe ejecutarse con el backend DRM y renderizado Pixman (software rendering) en lugar del acelerador G2D que causaba crashes.

**Archivo de configuración:** `/etc/xdg/weston/weston.ini`

```ini
[core]
idle-time=0
use-g2d=0
repaint-window=16
modules=screen-share.so

[libinput]
touchscreen_calibrator=true

[screen-share]
command=/usr/bin/weston --backend=rdp-backend.so --shell=fullscreen-shell.so --no-clients-resize --rdp-tls-cert=/etc/freerdp/keys/server.crt --rdp-tls-key=/etc/freerdp/keys/server.key
```

**Comando para iniciar Weston manualmente:**

```bash
export XDG_RUNTIME_DIR=/run/user/0
weston --backend=drm-backend.so --tty=2 --use-pixman &
```

**Notas importantes:**
- Se usa `--tty=2` en lugar de `--tty=1` para evitar conflictos
- `--use-pixman` fuerza el renderizado por software (más estable que G2D en este caso)
- El backend `drm-backend.so` es más confiable que `fbdev-backend.so`

### 2. Servicio Systemd para Chromium

**Archivo:** `/etc/systemd/system/chromium-kiosk.service`

```ini
[Unit]
Description=Chromium Kiosk Mode
After=weston.service multi-user.target
Wants=weston.service

[Service]
Type=simple
User=root
Environment="XDG_RUNTIME_DIR=/run/user/0"
Environment="WAYLAND_DISPLAY=wayland-0"
ExecStartPre=/bin/sleep 15
ExecStart=/bin/sh -c 'while [ ! -S /run/user/0/wayland-0 ]; do sleep 1; done; exec chromium --no-sandbox --disable-gpu --disable-gpu-compositing --kiosk --no-first-run --disable-infobars --disable-session-crashed-bubble --disable-translate https://gunjop.com'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=graphical.target
```

**Explicación de los parámetros de Chromium:**

- `--no-sandbox`: Necesario para ejecutar como root
- `--disable-gpu`: Desactiva aceleración GPU (evita crashes)
- `--disable-gpu-compositing`: Desactiva composición GPU
- `--kiosk`: Modo pantalla completa sin interfaz de navegador
- `--no-first-run`: Omite el asistente de primera ejecución
- `--disable-infobars`: Oculta barras de información
- `--disable-session-crashed-bubble`: No muestra mensaje de crash
- `--disable-translate`: Desactiva traducción automática

### 3. Instalación Paso a Paso

Ejecuta estos comandos en el dispositivo i.MX8MM vía SSH:

```bash
# 1. Crear el servicio systemd
cat > /etc/systemd/system/chromium-kiosk.service << 'EOF'
[Unit]
Description=Chromium Kiosk Mode
After=weston.service multi-user.target
Wants=weston.service

[Service]
Type=simple
User=root
Environment="XDG_RUNTIME_DIR=/run/user/0"
Environment="WAYLAND_DISPLAY=wayland-0"
ExecStartPre=/bin/sleep 15
ExecStart=/bin/sh -c 'while [ ! -S /run/user/0/wayland-0 ]; do sleep 1; done; exec chromium --no-sandbox --disable-gpu --disable-gpu-compositing --kiosk --no-first-run --disable-infobars --disable-session-crashed-bubble --disable-translate https://gunjop.com'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=graphical.target
EOF

# 2. Recargar systemd
systemctl daemon-reload

# 3. Habilitar el servicio para inicio automático
systemctl enable chromium-kiosk.service

# 4. Iniciar el servicio
systemctl start chromium-kiosk.service

# 5. Verificar el estado
systemctl status chromium-kiosk.service
```

### 4. Reiniciar el Sistema

```bash
reboot
```

Después del reinicio, el sistema debería:
1. Iniciar Weston automáticamente
2. Esperar 15 segundos para que Weston esté completamente listo
3. Verificar que el socket de Wayland existe
4. Iniciar Chromium en modo kiosko mostrando https://gunjop.com

## Comandos Útiles

### Gestión del Servicio

```bash
# Ver estado del servicio
systemctl status chromium-kiosk.service

# Reiniciar Chromium sin reiniciar el sistema
systemctl restart chromium-kiosk.service

# Detener Chromium
systemctl stop chromium-kiosk.service

# Deshabilitar inicio automático
systemctl disable chromium-kiosk.service

# Ver logs en tiempo real
journalctl -u chromium-kiosk.service -f

# Ver últimos 100 logs
journalctl -u chromium-kiosk.service -n 100 --no-pager
```

### Verificación del Sistema

```bash
# Verificar que Weston está corriendo
ps aux | grep weston

# Verificar que Chromium está corriendo
ps aux | grep chromium

# Verificar el socket de Wayland
ls -la /run/user/0/wayland-0

# Verificar dispositivos de display
ls -la /dev/dri/
cat /sys/class/drm/card*/status

# Verificar framebuffer
ls -la /dev/fb*
cat /sys/class/graphics/fb0/modes
```

### Ejecución Manual

Para probar Chromium manualmente sin el servicio:

```bash
export XDG_RUNTIME_DIR=/run/user/0
export WAYLAND_DISPLAY=wayland-0
chromium --no-sandbox --kiosk https://gunjop.com &
```

## Cambiar la URL de Inicio

Para cambiar la página web que se muestra al inicio:

1. Edita el servicio:
```bash
vi /etc/systemd/system/chromium-kiosk.service
```

2. Cambia `https://gunjop.com` por la URL deseada

3. Recarga y reinicia:
```bash
systemctl daemon-reload
systemctl restart chromium-kiosk.service
```

## Solución de Problemas

### Chromium no se inicia

```bash
# Ver logs del servicio
journalctl -u chromium-kiosk.service -n 50

# Verificar que Weston está corriendo
ps aux | grep weston

# Verificar el socket de Wayland
ls -la /run/user/0/wayland-0

# Si el socket no existe, reiniciar Weston
killall weston
weston --backend=drm-backend.so --tty=2 --use-pixman &
```

### Pantalla en negro

```bash
# Cambiar a TTY2 donde Weston está corriendo
chvt 2

# Verificar el framebuffer
cat /dev/urandom > /dev/fb0
# Presiona Ctrl+C después de ver "nieve estática"
```

### Procesos zombie de Weston

```bash
# Limpiar procesos zombie
killall -9 weston
sleep 2

# Reiniciar el sistema (solución más confiable)
reboot
```

### Errores de GPU

Si ves errores relacionados con GPU, asegúrate de usar los flags:
- `--disable-gpu`
- `--disable-gpu-compositing`

Estos desactivan la aceleración por hardware y usan renderizado por software.

## Hardware Detectado

- **Display:** HDMI-A-1, 1280x800@60Hz
- **Touchscreen:** eGalax Touch Screen (event1)
- **Teclado:** gpio-keys, snvs-powerkey
- **GPU:** i.MX8MM con renderizador G2D (desactivado por inestabilidad)
- **DRM:** card0 y card1 disponibles

## Notas Técnicas

1. **¿Por qué TTY2 en lugar de TTY1?**
   - TTY1 puede estar ocupado por la consola del sistema
   - TTY2 evita conflictos con otros servicios

2. **¿Por qué --use-pixman?**
   - El renderizador G2D causaba segmentation faults
   - Pixman es más lento pero más estable

3. **¿Por qué esperar 15 segundos?**
   - Weston necesita tiempo para inicializar completamente
   - El socket de Wayland se crea después de que Weston está listo

4. **¿Por qué ejecutar como root?**
   - Simplifica permisos de acceso a DRM y framebuffer
   - En producción, considera crear un usuario dedicado

## Referencias

- [Weston Documentation](https://wayland.freedesktop.org/)
- [Chromium Command Line Switches](https://peter.sh/experiments/chromium-command-line-switches/)
- [i.MX8MM Reference Manual](https://www.nxp.com/products/processors-and-microcontrollers/arm-processors/i-mx-applications-processors/i-mx-8-processors/i-mx-8m-mini-family:i.MX8MMINI)
