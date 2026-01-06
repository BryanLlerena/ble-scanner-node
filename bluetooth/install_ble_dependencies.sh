#!/bin/bash
# Script de instalación de dependencias BLE para Raspberry Pi/Yocto

echo "Instalando dependencias BLE Scanner..."

# Crear directorios necesarios
mkdir -p /usr/bin/application/ble
mkdir -p /usr/bin/application/scripts

# Configurar permisos para Bluetooth
echo "Configurando permisos Bluetooth..."

# Verificar que el usuario está en el grupo bluetooth
if ! groups $USER | grep -q '\bbluetooth\b'; then
    echo "Agregando usuario $USER al grupo bluetooth..."
    sudo usermod -a -G bluetooth $USER
fi

# Configurar udev rules para acceso sin sudo
echo 'SUBSYSTEM=="bluetooth", GROUP="bluetooth", MODE="0660"' | sudo tee /etc/udev/rules.d/99-bluetooth.rules

# Configurar systemd service (opcional)
cat > /tmp/ble-scanner.service << EOF
[Unit]
Description=BLE Scanner Service
After=bluetooth.service

[Service]
Type=forking
ExecStart=/usr/bin/application/ble_scanner
Restart=always
User=root
Group=bluetooth

[Install]
WantedBy=multi-user.target
EOF

echo "Para instalar como servicio, ejecuta:"
echo "sudo mv /tmp/ble-scanner.service /etc/systemd/system/"
echo "sudo systemctl enable ble-scanner.service"

# Configurar BlueZ para BLE
echo "Configurando BlueZ para BLE..."
if [ -f /etc/bluetooth/main.conf ]; then
    # Backup original
    sudo cp /etc/bluetooth/main.conf /etc/bluetooth/main.conf.backup
    
    # Habilitar BLE
    sudo sed -i 's/#ControllerMode = dual/ControllerMode = le/' /etc/bluetooth/main.conf
    sudo sed -i 's/#FastConnectable = false/FastConnectable = true/' /etc/bluetooth/main.conf
fi

echo "¡Instalación completada!"
echo "Reinicia el sistema o ejecuta 'sudo systemctl restart bluetooth' para aplicar cambios"