#!/bin/sh

# Esperar a que Weston esté completamente iniciado
sleep 5

# Configurar variables de entorno
export XDG_RUNTIME_DIR=/run/user/0
export WAYLAND_DISPLAY=wayland-0

# Iniciar Chromium en modo kiosko con la página especificada
chromium --no-sandbox \
    --disable-gpu \
    --disable-gpu-compositing \
    --kiosk \
    --no-first-run \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-translate \
    https://gunjop.com &
