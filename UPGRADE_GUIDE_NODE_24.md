# Guía de Actualización a Node.js 24 (Desde v22)

Esta guía detalla los pasos para actualizar una instalación existente de Node.js v22 a v24 en la tablet configurada según `README_TABLET_SETUP.md`.

## 0. Instalar Editor de Texto (Nano)

Para facilitar la edición de archivos de configuración, recomendamos instalar `nano` si no está disponible.

```bash
apt-get update
apt-get install -y nano
```

## 1. Detener Servicios

Primero, detenemos los servicios para liberar los archivos de Node.js y evitar conflictos.

```bash
# Detener PM2 y todos los procesos gestionados
pm2 stop all
pm2 kill

# (Opcional) Si la tablet usa el modo Kiosk, detener Chromium también
systemctl stop chromium-kiosk.service
```

## 2. Backup de la Versión Anterior

Es recomendable guardar la versión anterior por si algo falla y necesitas revertir rápidamente.

```bash
cd /mnt/storage
mv nodejs nodejs_old_v22
```

## 3. Instalar Node.js 24

Descargamos e instalamos la versión más reciente de Node.js 24 (LTS/Current) compatible con ARM64.  
*Versión utilizada en esta guía: v24.13.1*

```bash
# 1. Descargar el binario comprimido
wget https://nodejs.org/dist/v24.13.1/node-v24.13.1-linux-arm64.tar.xz -P /tmp

# 2. Descomprimir el archivo
tar -xf /tmp/node-v24.13.1-linux-arm64.tar.xz

# 3. Renombrar a 'nodejs' para mantener la compatibilidad con los paths existentes (/mnt/storage/nodejs)
mv node-v24.13.1-linux-arm64 nodejs

# 4. Limpiar archivos temporales
rm /tmp/node-v24.13.1-linux-arm64.tar.xz
```

## 4. Verificar Instalación y Permisos

Al reemplazar la carpeta `nodejs`, los enlaces simbólicos (`/usr/bin/node`, etc.) deberían seguir apuntando al lugar correcto, pero es crucial restaurar los permisos especiales para Bluetooth.

```bash
# Verificar que la versión sea la correcta
node -v
# Debería mostrar: v24.13.1

# IMPORTANTE: Restaurar permisos de Bluetooth (necesario para la librería noble)
# Sin esto, el escáner fallará silenciosamente o pedirá root
setcap cap_net_raw+eip $(eval readlink -f `which node`)
```

## 5. Restaurar PM2 Global

Al cambiar la carpeta de Node.js, se pierden los módulos globales instalados previamente. Necesitamos reinstalar PM2 en la nueva versión.

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Asegurar que el enlace simbólico de PM2 sea correcto
ln -sf /mnt/storage/nodejs/bin/pm2 /usr/bin/pm2

# Actualizar el daemon de PM2 en memoria
pm2 update
```

## 6. Reconstruir Dependencias del Proyecto

Los módulos nativos (compilados C++) como `sqlite3` y `@abandonware/noble` están vinculados a la versión específica de Node.js con la que se instalaron. Al cambiar de v22 a v24, **deben recompilarse** o la aplicación fallará.

```bash
# DIRÍGETE A LA CARPETA DEL ESCÁNER
cd /mnt/storage/www/ble-scanner-node

# Eliminar node_modules para una instalación limpia (Recomendado para evitar errores de ABI)
rm -rf node_modules package-lock.json

# Reinstalar dependencias (esto compilará automáticamente los módulos para Node 24)
npm install
```

*(Opcional: Si tienes instalada la `app-porvenir` u otras apps, repite este paso en sus respectivas carpetas).*

## 7. Reiniciar Servicios

Una vez reconstruido todo, reiniciamos la operación normal.

```bash
# Volver a la carpeta del scanner
cd /mnt/storage/www/ble-scanner-node

# Iniciar todo con PM2
pm2 start ecosystem.config.js

# Guardar la lista de procesos para el arranque automático
pm2 save

# Reiniciar el modo Kiosk (si lo detuviste)
systemctl start chromium-kiosk.service
```

## 8. Verificación Final

Verifica que el escáner esté funcionando correctamente y detectando dispositivos.

```bash
# Ver estado de los procesos
pm2 status

# Ver logs (busca errores de "version mismatch" o "bindings")
pm2 logs ble-scanner --lines 50
```

Si todo está correcto, ¡ya tienes tu sistema corriendo en Node.js 24!

## Solución de Problemas

### Error: Temporary failure in name resolution (wget failure)
Si al intentar descargar Node.js obtienes un error de resolução de nombres, es probable que falte configurar el DNS.

**Solución rápida:**
Agrega el DNS de Google temporalmente al archivo `/etc/resolv.conf`:

```bash
echo "nameserver 8.8.8.8" > /etc/resolv.conf
```

Luego intenta ejecutar el comando `wget` nuevamente.
