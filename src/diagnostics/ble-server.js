// Servidor BLE para diagnósticos (Peripheral Mode)
require('dotenv').config();
const bleno = require('@abandonware/bleno');
const http = require('http');

const DEVICE_NAME = 'VTBOX-Status';
const SERVICE_UUID = '12345678123456781234567812345678';
const WIFI_CHAR_UUID = '87654321876543218765432187654321';
const MACS_CHAR_UUID = '11112222333344445555666677778888';

// Helper para hacer peticiones HTTP locales a nuestra propia API
function fetchLocalData(path) {
    return new Promise((resolve, reject) => {
        http.get({
            hostname: '127.0.0.1',
            port: 3035, // Puerto del wifi-status.js
            path: path,
            agent: false
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// === FIN HELPER ===

let currentAdvertisedName = "VTBOX-Init";
let advertiseInterval = null;

function updateAdvertising() {
    Promise.all([
        fetchLocalData('/api/wifi/status').catch(() => ({ status: 'error' })),
        fetchLocalData('/api/ble/recent').catch(() => ([]))
    ]).then(([wifiData, bleData]) => {
        // Formato ultra-compacto para que quepa en el límite de ~29 bytes del nombre de BLE
        // WiFi: W=ON/OFF. Si es ON, ponemos SSID.
        let wifiTxt = `W:${wifiData.status === 'connected' ? 'ON' : 'OFF'}`;
        if (wifiData.status === 'connected' && wifiData.ssid) {
            wifiTxt += `|${wifiData.ssid.substring(0, 8)}`; // Max 8 chars del SSID
        }

        // MAC: La más cercana, solo 4 caracteres de MAC y RSSI
        let macTxt = '';
        if (Array.isArray(bleData) && bleData.length > 0) {
            const topMac = bleData[0];
            // Ejemplo de beaconMac: 'af:20:24:00:00:61' -> últimos 5 chars: '00:61' -> quitamos ':' -> '0061'
            const last4Digits = topMac.beaconMac.slice(-5).replace(':', '').toUpperCase();
            macTxt = ` M:${last4Digits}(${topMac.rssi})`; // Ej "M:0061(-44)"
        }

        // Ensamblamos el nuevo nombre (Debe ser < 29 caracteres totales en la práctica)
        let newName = `${wifiTxt}${macTxt}`.substring(0, 26); // Hard limit de seguridad

        if (newName !== currentAdvertisedName) {
            console.log(`[BLE Server] Info actualizada. Nuevo nombre de Advertising: "${newName}" (Len: ${newName.length})`);
            currentAdvertisedName = newName;

            // Si bleno está encendido, relanzamos el grito (advertising)
            if (bleno.state === 'poweredOn') {
                bleno.stopAdvertising(() => {
                    bleno.startAdvertising(currentAdvertisedName, [SERVICE_UUID]);
                });
            }
        }
    });
}

console.log('[BLE Server] Iniciando servicio de diagnósticos VT-BOX en modo CONNECTIONLESS (Advertising)...');

bleno.on('stateChange', function (state) {
    console.log(`[BLE Server] Cambio de estado bleno: ${state}`);

    if (state === 'poweredOn') {
        // Arrancamos con el nombre inicial
        bleno.startAdvertising(currentAdvertisedName, [SERVICE_UUID]);

        // Iniciamos el bucle para actualizar el nombre dinámicamente cada 3 segundos
        if (!advertiseInterval) {
            advertiseInterval = setInterval(updateAdvertising, 3000);
        }
    } else {
        bleno.stopAdvertising();
        if (advertiseInterval) {
            clearInterval(advertiseInterval);
            advertiseInterval = null;
        }
    }
});

bleno.on('advertisingStart', function (error) {
    if (error) {
        console.error(`[BLE Server] Error iniciando advertising: ${error}`);
    } else {
        console.log(`[BLE Server] Advertising emitido exitosamente. Nombre: "${currentAdvertisedName}"`);
    }
});

// En modo baliza puro no nos interesa que se conecten, pero por si acaso, logueamos si lo intentan
bleno.on('accept', function (clientAddress) {
    console.log(`[BLE Server] ADVERTENCIA: Cliente intentó conectarse: ${clientAddress}. (No se esperan servicios)`);
});

bleno.on('disconnect', function (clientAddress) {
    console.log(`[BLE Server] Cliente desconectado: ${clientAddress}`);
});
