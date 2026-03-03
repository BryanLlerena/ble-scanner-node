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

// Característica para leer el estado del WiFi
class WifiCharacteristic extends bleno.Characteristic {
    constructor() {
        super({
            uuid: WIFI_CHAR_UUID,
            properties: ['read'],
            value: null
        });
    }

    async onReadRequest(offset, callback) {
        console.log('[BLE Server] Petición de lectura de WiFi recibida');
        try {
            const wifiData = await fetchLocalData('/api/wifi/status');
            const responseText = `WIFI: ${wifiData.status.toUpperCase()} | SSID: ${wifiData.ssid || 'N/A'} | BSSID: ${wifiData.bssid || 'N/A'}`;
            console.log(`[BLE Server] Respondiendo WiFi: ${responseText}`);
            const data = Buffer.from(responseText, 'utf8');
            callback(this.RESULT_SUCCESS, data.slice(offset));
        } catch (err) {
            console.error('[BLE Server] Error leyendo WiFi:', err.message);
            const data = Buffer.from('Error obteniendo estado WIFI', 'utf8');
            callback(this.RESULT_SUCCESS, data.slice(offset));
        }
    }
}

// Característica para leer MACs recientes
class MacsCharacteristic extends bleno.Characteristic {
    constructor() {
        super({
            uuid: MACS_CHAR_UUID,
            properties: ['read'],
            value: null
        });
    }

    async onReadRequest(offset, callback) {
        console.log('[BLE Server] Petición de lectura de MACs Scanner recibida');
        try {
            const bleData = await fetchLocalData('/api/ble/recent');
            let responseText = `MACs (últimos 30s): `;

            if (Array.isArray(bleData) && bleData.length > 0) {
                // Tomar las 3 MACs más recientes/fuertes para no exceder límites de MTU muy fácilmente
                const topMacs = bleData.slice(0, 3).map(b => `${b.beaconMac} (${b.rssi}dBm)`).join(', ');
                responseText += topMacs;
                if (bleData.length > 3) responseText += `... (+${bleData.length - 3} más)`;
            } else {
                responseText += 'Ninguna detectada';
            }

            console.log(`[BLE Server] Respondiendo MACs: ${responseText}`);
            const data = Buffer.from(responseText, 'utf8');

            // Notas sobre MTU: En BLE clásico el máximo es ~20-23 bytes sin negociar MTU
            // Dependiendo del cliente, puede truncarse. Retornamos todo y dejamos que cliente lo maneje.
            callback(this.RESULT_SUCCESS, data.slice(offset));
        } catch (err) {
            console.error('[BLE Server] Error leyendo MACs:', err.message);
            const data = Buffer.from('Error obteniendo MACs Scanner', 'utf8');
            callback(this.RESULT_SUCCESS, data.slice(offset));
        }
    }
}

console.log('[BLE Server] Iniciando servicio de diagnósticos VT-BOX...');

bleno.on('stateChange', function (state) {
    console.log(`[BLE Server] Cambio de estado bleno: ${state}`);

    if (state === 'poweredOn') {
        bleno.startAdvertising(DEVICE_NAME, [SERVICE_UUID]);
    } else {
        bleno.stopAdvertising();
    }
});

bleno.on('advertisingStart', function (error) {
    if (error) {
        console.error(`[BLE Server] Error iniciando advertising: ${error}`);
    } else {
        console.log(`[BLE Server] Advertising iniciado. Nombre: ${DEVICE_NAME}`);
        bleno.setServices([
            new bleno.PrimaryService({
                uuid: SERVICE_UUID,
                characteristics: [
                    new WifiCharacteristic(),
                    new MacsCharacteristic()
                ]
            })
        ]);
    }
});

bleno.on('accept', function (clientAddress) {
    console.log(`[BLE Server] Cliente conectado: ${clientAddress}`);
});

bleno.on('disconnect', function (clientAddress) {
    console.log(`[BLE Server] Cliente desconectado: ${clientAddress}`);
});
