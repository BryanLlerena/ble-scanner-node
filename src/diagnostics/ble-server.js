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

// Característica NOTIFICABLE para enviar el estado del WiFi continuamente
class WifiCharacteristic extends bleno.Characteristic {
    constructor() {
        super({
            uuid: WIFI_CHAR_UUID,
            properties: ['read', 'notify'], // Agregamos 'notify'
            value: null
        });
        this.intervalId = null;
        this.updateValueCallback = null;
    }

    // Si alguien lee manualmente
    async onReadRequest(offset, callback) {
        try {
            const wifiData = await fetchLocalData('/api/wifi/status');
            const responseText = `WIFI:${wifiData.status}|SSID:${wifiData.ssid || 'N/A'}`;
            callback(this.RESULT_SUCCESS, Buffer.from(responseText, 'utf8').slice(offset));
        } catch (err) {
            callback(this.RESULT_SUCCESS, Buffer.from('Error WIFI', 'utf8').slice(offset));
        }
    }

    // Cuando el cliente enciende "NOTIFY" (suscripción)
    onSubscribe(maxValueSize, updateValueCallback) {
        console.log('[BLE Server] Cliente SUSCRITO al WiFi (NOTIFY ACTIVADO)');
        this.updateValueCallback = updateValueCallback;

        // Empezar a enviar datos cada 2 segundos
        this.intervalId = setInterval(async () => {
            try {
                if (!this.updateValueCallback) return; // Ya no hay cliente

                const wifiData = await fetchLocalData('/api/wifi/status');

                // RECORTADO EXTREMO PARA MTU (Max 20 bytes)
                // Ejemplo "W:CONNECTED" (11 chars) o "W:UNDIS_FMS" (11 chars)
                let responseText = `W:${wifiData.status === 'connected' ? 'ON' : 'OFF'}`;
                if (wifiData.status === 'connected' && wifiData.ssid) {
                    responseText += `|${wifiData.ssid.substring(0, 10)}`;
                }

                console.log(`[📡 PUSH WiFi] -> ${responseText} (Len: ${responseText.length})`);

                // Enviar notificación al cliente
                this.updateValueCallback(Buffer.from(responseText, 'utf8'));
            } catch (err) {
                console.error('[BLE Server] Error enviando notificación WiFi:', err.message);
            }
        }, 2000);
    }

    // Cuando el cliente apaga "NOTIFY" o se desconecta
    onUnsubscribe() {
        console.log('[BLE Server] Cliente DE-SUSCRITO del WiFi (NOTIFY APAGADO)');
        this.updateValueCallback = null;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
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
                    new WifiCharacteristic()
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
