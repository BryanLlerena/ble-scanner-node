-Montar antes la particion y moverse a ?/ata
- Comando descargar Node
wget --no-check-certificate https://nodejs.org/dist/v22.21.1/node-v22.21.1-linux-arm64.tar.xz -P /tmp

- Validar descarga 
-rw-r--r-- 1 root root 15M Dec 23 15:00 /tmp/node-v22.21.1-linux-arm64.tar.xz

- Validar Archivo y descomprimir
cd /data
tar -xf /tmp/node-v22.21.1-linux-arm64.tar.xz

- Renombrar 
mv node-v22.21.1-linux-arm64 nodejs

- Enlaces Simbolicos 
ln -s /data/nodejs/bin/node /usr/bin/node
ln -s /data/nodejs/bin/npm /usr/bin/npm
ln -s /data/nodejs/bin/npx /usr/bin/npx

- Agregar Binarios al Path
export PATH="/data/nodejs/bin:$PATH"
echo 'export PATH="/data/nodejs/bin:$PATH"' >> /etc/profile

- Verificar instalacion
node --version
npm --version

- Instalar Pm2
npm install -g pm2
ln -s /data/nodejs/bin/pm2 /usr/bin/pm2

- Inicar pm2 al reiniciar
pm2 startup

- Limpiar archivos temporales
rm /tmp/node-v22.21.1-linux-arm64.tar.xz