# 📡 Actualización Rápida: Dashboard v2

Sigue estos pasos en la terminal de la Tablet para activar el nuevo Dashboard Unificado y el modo Kiosk.

## 1. Descargar Cambios
Descarga el código más reciente con las optimizaciones de "Live View" y "Average RSSI".
```bash
cd /mnt/storage/www/ble-scanner-node
git pull
```

## 2. Actualizar Procesos (PM2)
Reinicia los procesos para que tomen los cambios de `wifi-status.js` y `index.js`.
```bash
pm2 restart ecosystem.config.js
pm2 save
```

## 3. Actualizar Modo Kiosk (Chromium)
Necesitas apuntar el navegador al nuevo puerto **3035**.

### Opción A: Script Automático (Recomendado)
Crea y ejecuta este script rápido:
```bash
# 1. Crear el script
cat << 'EOF' > update_kiosk.sh
#!/bin/bash
echo "Actualizando puerto Kiosk a 3035..."
sed -i 's/localhost:[0-9]*/localhost:3035/g' /etc/systemd/system/chromium-kiosk.service
systemctl daemon-reload
systemctl restart chromium-kiosk.service
EOF

# 2. Ejecutarlo
chmod +x update_kiosk.sh
sudo ./update_kiosk.sh
```

### Opción B: Manual (Si prefieres editar)
1. Edita el archivo de servicio:
   ```bash
   nano /etc/systemd/system/chromium-kiosk.service
   ```
2. Busca la línea que empieza por `ExecStart` y cambia la URL al final:
   - **Antes:** `http://localhost:3000` (o 3001)
   - **Ahora:** `http://localhost:3035`
3. Guarda (`Ctrl+O`, `Enter`) y Sal (`Ctrl+X`).
4. Reinicia el servicio:
   ```bash
   systemctl daemon-reload
   systemctl restart chromium-kiosk.service
   ```

---
**¡Listo!** La pantalla debería recargarse y mostrar el nuevo Dashboard Unificado con la vista en vivo real.
