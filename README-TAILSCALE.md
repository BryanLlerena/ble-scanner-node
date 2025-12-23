# 🔐 Instalación de Tailscale en Yocto Linux

Guía completa para instalar y configurar Tailscale en tu dispositivo Yocto Linux (ARM64), permitiendo acceso remoto seguro sin necesidad de estar en la misma red local.

## 📋 ¿Qué es Tailscale?

Tailscale es una VPN de malla (mesh VPN) que crea una red privada segura entre tus dispositivos. Con Tailscale podrás:

- ✅ Conectarte remotamente a tu tablet Yocto desde cualquier lugar
- ✅ Acceso SSH seguro sin abrir puertos en tu router
- ✅ No requiere configuración de firewall o port forwarding
- ✅ Conexión peer-to-peer cifrada
- ✅ Fácil gestión desde panel web o app móvil

## 🛠️ Requisitos Previos

- **Sistema**: Yocto Linux ARM64
- **Almacenamiento**: ~100MB libres en `/mnt/storage`
- **Red**: Conexión a Internet activa
- **Cuenta**: Cuenta gratuita de Tailscale (crear en https://tailscale.com)

## 🚀 Instalación Paso a Paso

### Opción 1: Instalación con Binario Estático (Recomendado)

Esta es la forma más sencilla y compatible con Yocto.

#### 1. Descargar Tailscale

```bash
# Crear directorio para Tailscale
mkdir -p /mnt/storage/tailscale
cd /mnt/storage/tailscale

# Descargar la última versión para ARM64
wget https://pkgs.tailscale.com/stable/tailscale_1.56.1_arm64.tgz

# Extraer archivos
tar xzf tailscale_1.56.1_arm64.tgz
cd tailscale_1.56.1_arm64
```

> **Nota**: Verifica la última versión disponible en https://pkgs.tailscale.com/stable/

#### 2. Instalar Binarios

```bash
# Copiar binarios a ubicación del sistema
cp tailscale /usr/bin/
cp tailscaled /usr/sbin/

# Dar permisos de ejecución
chmod +x /usr/bin/tailscale
chmod +x /usr/sbin/tailscaled

# Crear directorio de estado
mkdir -p /var/lib/tailscale
```

#### 3. Crear Servicio Systemd

Crea el archivo de servicio para que Tailscale inicie automáticamente:

```bash
cat > /etc/systemd/system/tailscaled.service << 'EOF'
[Unit]
Description=Tailscale node agent
Documentation=https://tailscale.com/kb/
Wants=network-pre.target
After=network-pre.target NetworkManager.service systemd-resolved.service

[Service]
EnvironmentFile=/etc/default/tailscaled
ExecStartPre=/usr/sbin/tailscaled --cleanup
ExecStart=/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --port 41641
ExecStopPost=/usr/sbin/tailscaled --cleanup
Restart=on-failure
RuntimeDirectory=tailscale
RuntimeDirectoryMode=0755
StateDirectory=tailscale
StateDirectoryMode=0700
CacheDirectory=tailscale
CacheDirectoryMode=0750
Type=notify

[Install]
WantedBy=multi-user.target
EOF
```

#### 4. Crear Archivo de Configuración

```bash
# Crear archivo de variables de entorno
cat > /etc/default/tailscaled << 'EOF'
# Tailscale configuration
# Puedes agregar flags adicionales aquí si es necesario
FLAGS=""
EOF
```

#### 5. Habilitar e Iniciar Servicio

```bash
# Recargar systemd
systemctl daemon-reload

# Habilitar inicio automático
systemctl enable tailscaled

# Iniciar servicio
systemctl start tailscaled

# Verificar estado
systemctl status tailscaled
```

#### 6. Autenticar con Tailscale

```bash
# Conectar tu dispositivo a tu red Tailscale
tailscale up

# Esto generará una URL de autenticación
# Copia la URL y ábrela en tu navegador para autorizar el dispositivo
```

**Ejemplo de salida:**
```
To authenticate, visit:

    https://login.tailscale.com/a/xxxxxxxxxx

```

Abre esa URL en tu navegador, inicia sesión con tu cuenta de Tailscale y autoriza el dispositivo.

#### 7. Verificar Conexión

```bash
# Ver estado de Tailscale
tailscale status

# Ver tu IP de Tailscale
tailscale ip -4

# Hacer ping a otro dispositivo en tu red Tailscale
tailscale ping <nombre-dispositivo>
```

---

### Opción 2: Instalación desde Repositorio (Alternativa)

Si tu sistema Yocto tiene `opkg` configurado con repositorios actualizados:

```bash
# Actualizar repositorios
opkg update

# Intentar instalar Tailscale
opkg install tailscale

# Si no está disponible, usar Opción 1
```

---

## ⚙️ Configuración Avanzada

### Configurar Nombre del Dispositivo

```bash
# Asignar un nombre descriptivo a tu tablet
tailscale up --hostname=tablet-yocto-01
```

### Habilitar SSH sobre Tailscale

```bash
# Asegurarte de que SSH esté habilitado
systemctl enable sshd
systemctl start sshd

# Permitir SSH en Tailscale
tailscale up --ssh
```

Ahora podrás conectarte vía SSH usando:
```bash
ssh root@tablet-yocto-01
# O usando la IP de Tailscale
ssh root@100.x.x.x
```

### Configurar como Exit Node (Opcional)

Si quieres usar tu tablet como punto de salida a Internet:

```bash
# Habilitar IP forwarding
echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.conf
echo 'net.ipv6.conf.all.forwarding = 1' >> /etc/sysctl.conf
sysctl -p

# Anunciar como exit node
tailscale up --advertise-exit-node
```

### Configurar Rutas Personalizadas

Si quieres acceder a la red local de tu tablet desde otros dispositivos:

```bash
# Ejemplo: anunciar la red 192.168.1.0/24
tailscale up --advertise-routes=192.168.1.0/24
```

---

## 🔧 Comandos Útiles

### Gestión Básica

```bash
# Ver estado completo
tailscale status

# Ver IP asignada
tailscale ip

# Desconectar temporalmente
tailscale down

# Reconectar
tailscale up

# Ver logs
journalctl -u tailscaled -f

# Actualizar configuración
tailscale up --reset
```

### Diagnóstico

```bash
# Verificar conectividad
tailscale ping <dispositivo>

# Ver información de red
tailscale netcheck

# Debug completo
tailscale debug
```

### Gestión de Dispositivos

```bash
# Listar todos tus dispositivos
tailscale status

# Ver detalles de conexión
tailscale status --json

# Cerrar sesión (desautorizar dispositivo)
tailscale logout
```

---

## 🌐 Acceso Remoto

### Desde tu PC/Laptop

1. **Instala Tailscale** en tu computadora:
   - Windows: https://tailscale.com/download/windows
   - macOS: https://tailscale.com/download/mac
   - Linux: https://tailscale.com/download/linux

2. **Inicia sesión** con la misma cuenta

3. **Conéctate a tu tablet**:
   ```bash
   # SSH
   ssh root@tablet-yocto-01
   
   # O usando la IP de Tailscale
   ssh root@100.x.x.x
   ```

### Desde tu Móvil

1. **Descarga la app** de Tailscale:
   - iOS: App Store
   - Android: Google Play

2. **Inicia sesión** con tu cuenta

3. **Usa apps SSH** como Termius o JuiceSSH para conectarte

---

## 🔐 Seguridad

### Mejores Prácticas

```bash
# 1. Usar autenticación por clave SSH (recomendado)
# En tu PC, genera una clave si no tienes:
ssh-keygen -t ed25519

# Copia la clave pública a tu tablet
ssh-copy-id root@tablet-yocto-01

# 2. Deshabilitar autenticación por contraseña
nano /etc/ssh/sshd_config
# Cambiar: PasswordAuthentication no
systemctl restart sshd

# 3. Configurar ACLs en Tailscale (desde el panel web)
# https://login.tailscale.com/admin/acls
```

### Control de Acceso

Desde el panel web de Tailscale (https://login.tailscale.com):

- **Gestionar dispositivos**: Ver, renombrar, eliminar
- **Compartir dispositivos**: Invitar a otros usuarios
- **ACLs**: Definir quién puede acceder a qué
- **Claves de autenticación**: Generar claves para instalaciones automatizadas

---

## 🐛 Solución de Problemas

### Tailscale no inicia

```bash
# Verificar logs
journalctl -u tailscaled -n 50

# Verificar que los binarios existen
which tailscale
which tailscaled

# Reiniciar servicio
systemctl restart tailscaled
```

### No puedo autenticar

```bash
# Verificar conectividad a Internet
ping -c 3 8.8.8.8

# Intentar autenticación nuevamente
tailscale down
tailscale up
```

### Conexión lenta o intermitente

```bash
# Verificar estado de red
tailscale netcheck

# Forzar reconexión
tailscale down
sleep 2
tailscale up

# Ver rutas activas
ip route | grep tailscale
```

### Dispositivo no aparece en la red

```bash
# Verificar estado del servicio
systemctl status tailscaled

# Verificar firewall (si aplica)
iptables -L -n | grep tailscale

# Reiniciar con logs de debug
tailscaled --verbose=2
```

---

## 🔄 Actualización de Tailscale

```bash
# Descargar nueva versión
cd /tmp
wget https://pkgs.tailscale.com/stable/tailscale_NUEVA_VERSION_arm64.tgz
tar xzf tailscale_NUEVA_VERSION_arm64.tgz
cd tailscale_NUEVA_VERSION_arm64

# Detener servicio
systemctl stop tailscaled

# Reemplazar binarios
cp tailscale /usr/bin/
cp tailscaled /usr/sbin/

# Reiniciar servicio
systemctl start tailscaled

# Verificar versión
tailscale version
```

---

## 📊 Integración con tu Sistema BLE

Ahora que tienes Tailscale instalado, puedes acceder remotamente a tu sistema BLE:

### Monitoreo Remoto

```bash
# Conectarte vía SSH desde cualquier lugar
ssh root@tablet-yocto-01

# Ver logs de PM2 remotamente
pm2 logs

# Verificar estado de servicios
pm2 status

# Ver datos BLE en tiempo real
node view-data.js
```

### Túnel HTTP (Opcional)

Si quieres acceder a servicios web en tu tablet:

```bash
# Habilitar MagicDNS en Tailscale (desde panel web)
# Luego podrás acceder a:
# http://tablet-yocto-01:3000
```

---

## 📋 Lista de Verificación Post-Instalación

### ✅ Instalación
- [ ] Binarios `tailscale` y `tailscaled` instalados
- [ ] Servicio systemd creado y habilitado
- [ ] Servicio `tailscaled` ejecutándose correctamente
- [ ] Dispositivo autenticado con tu cuenta Tailscale

### ✅ Conectividad
- [ ] `tailscale status` muestra dispositivo conectado
- [ ] IP de Tailscale asignada (`tailscale ip`)
- [ ] Ping exitoso a otros dispositivos Tailscale
- [ ] SSH funcional sobre Tailscale

### ✅ Configuración
- [ ] Nombre de dispositivo configurado
- [ ] Inicio automático habilitado
- [ ] ACLs configuradas (si es necesario)
- [ ] Claves SSH configuradas (recomendado)

---

## 💡 Casos de Uso

### 1. Mantenimiento Remoto
```bash
# Desde casa, conectarte a tu tablet en la oficina
ssh root@tablet-yocto-01
pm2 restart all
```

### 2. Debugging en Producción
```bash
# Ver logs en tiempo real
ssh root@tablet-yocto-01 "pm2 logs --lines 100"
```

### 3. Transferencia de Archivos
```bash
# Copiar archivos de forma segura
scp archivo.txt root@tablet-yocto-01:/mnt/storage/www/

# O desde la tablet a tu PC
scp root@tablet-yocto-01:/mnt/storage/databases/beacons.db ./
```

### 4. Backup Remoto
```bash
# Script de backup automático
ssh root@tablet-yocto-01 "tar czf /tmp/backup.tar.gz /mnt/storage/databases"
scp root@tablet-yocto-01:/tmp/backup.tar.gz ./backups/
```

---

## 🌟 Ventajas de Tailscale vs Otras Soluciones

| Característica | Tailscale | VPN Tradicional | Port Forwarding |
|----------------|-----------|-----------------|-----------------|
| **Configuración** | ⭐⭐⭐⭐⭐ Muy fácil | ⭐⭐ Compleja | ⭐⭐⭐ Media |
| **Seguridad** | ⭐⭐⭐⭐⭐ WireGuard | ⭐⭐⭐⭐ Variable | ⭐⭐ Baja |
| **Rendimiento** | ⭐⭐⭐⭐⭐ P2P directo | ⭐⭐⭐ Servidor central | ⭐⭐⭐⭐ Directo |
| **NAT Traversal** | ⭐⭐⭐⭐⭐ Automático | ⭐⭐ Manual | ❌ No funciona |
| **Multi-plataforma** | ⭐⭐⭐⭐⭐ Todas | ⭐⭐⭐ Limitado | ⭐⭐⭐ Limitado |
| **Costo** | ⭐⭐⭐⭐⭐ Gratis (básico) | ⭐⭐⭐ Variable | ⭐⭐⭐⭐⭐ Gratis |

---

## 📞 Recursos Adicionales

- **Documentación oficial**: https://tailscale.com/kb/
- **Panel de administración**: https://login.tailscale.com/admin/
- **Comunidad**: https://forum.tailscale.com/
- **GitHub**: https://github.com/tailscale/tailscale

---

## ❓ Preguntas Frecuentes

### ¿Tailscale consume mucha batería?
No, el consumo es mínimo cuando no hay tráfico activo. Solo mantiene una conexión keepalive ligera.

### ¿Funciona sin Internet?
No, Tailscale requiere Internet para el control plane (autenticación y coordinación), pero el tráfico de datos va peer-to-peer.

### ¿Cuántos dispositivos puedo conectar?
El plan gratuito permite hasta 20 dispositivos y 1 usuario. Planes pagos ofrecen más.

### ¿Es seguro?
Sí, usa WireGuard (protocolo VPN moderno y auditado) con cifrado de extremo a extremo.

### ¿Puedo usar mi propio servidor de coordinación?
Sí, Tailscale es open source. Puedes usar Headscale (implementación self-hosted del control plane).

---

**¡Listo! Ahora tienes acceso remoto seguro a tu tablet Yocto desde cualquier lugar del mundo** 🚀🔐
