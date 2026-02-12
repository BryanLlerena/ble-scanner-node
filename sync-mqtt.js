// Servicio MQTT para envío de datos de beacons
require('dotenv').config();
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
const logger = require('./logger');
const wifiUtils = require('./wifi-utils');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');

const UNIT = process.env.UNIT || "TEST_UNIT";
const DB_FILE = process.env.DB_FILE || 'beacons.db';
const COMPANY = process.env.MQTT_COMPANY || 'gunjop';

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const MQTT_CLIENT_ID = `${uuidv4()}_${UNIT}`;
const MQTT_USERNAME = process.env.MQTT_USERNAME || null;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || null;
const MQTT_INTERVAL = parseInt(process.env.MQTT_INTERVAL) || 60000;
const MQTT_TOPIC = `${COMPANY}/unit/${UNIT.toLowerCase()}/tracking`;
const MQTT_GPS_TOPIC = `${COMPANY}/unit/${UNIT.toLowerCase()}/gps`;

// Cliente MQTT
let mqttClient = null;
let db = null;

// Variables para almacenar datos recientes
let lastBeaconEvents = [];
let lastGPSData = null;

// Configuración del cliente MQTT
const mqttOptions = {
  clientId: MQTT_CLIENT_ID,
  clean: true,
  connectTimeout: 10000,
  reconnectPeriod: 5000,
  keepalive: 60
};

if (MQTT_USERNAME && MQTT_PASSWORD) {
  mqttOptions.username = MQTT_USERNAME;
  mqttOptions.password = MQTT_PASSWORD;
}

async function getWifiInfo() {
  return await wifiUtils.getWifiInfo();
}

// Función para leer datos GPS
function readGPSData(callback) {
  const gpsProcess = spawn('sh', ['/usr/bin/gps_runner.sh']);
  gpsProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      // Buscar línea NMEA GGA
      if (line.includes('GGA')) {
        const parts = line.split(',');
        if (parts[2] && parts[4] && parts[6] !== '0') {
          // Convertir NMEA a decimal
          const lat = nmeaToDecimal(parts[2], parts[3]);
          const lon = nmeaToDecimal(parts[4], parts[5]);
          if (lat !== null && lon !== null) {
            lastGPSData = {
              latitude: lat,
              longitude: lon,
              fix: parts[6],
              timestamp: Date.now()
            };
            callback(lastGPSData);
            gpsProcess.kill();
            break;
          }
        }
      }
    }
  });
  gpsProcess.stderr.on('data', (data) => {
    logger.warn('GPS stderr:', data.toString());
  });
  gpsProcess.on('error', (err) => {
    logger.error('GPS process error:', err.message);
  });
}

// Convertir NMEA a decimal
function nmeaToDecimal(nmea, direction) {
  if (!nmea || !nmea.includes('.')) return null;
  const dotPos = nmea.indexOf('.');
  const degrees = parseFloat(nmea.substring(0, dotPos - 2));
  const minutes = parseFloat(nmea.substring(dotPos - 2));
  let decimal = degrees + (minutes / 60);
  if (direction === 'S' || direction === 'W') decimal *= -1;
  return decimal;
}

// Calcular estadísticas RSSI
function calculateBeaconStats(rssiArray) {
  if (!rssiArray || rssiArray.length === 0) {
    return {
      rssi_min: 0,
      rssi_max: 0,
      rssi_mean: 0,
      distance: 0,
      duration: 0
    };
  }

  const rssiValues = rssiArray.map(entry => entry.rssi);
  const distances = rssiArray.map(entry => entry.distance);
  const timestamps = rssiArray.map(entry => entry.datetime);

  const rssi_min = Math.min(...rssiValues);
  const rssi_max = Math.max(...rssiValues);
  const rssi_mean = rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length;
  const distance = distances.reduce((a, b) => a + b, 0) / distances.length;

  // Calcular duración desde primera hasta última lectura
  const firstTimestamp = Math.min(...timestamps);
  const lastTimestamp = Math.max(...timestamps);
  const duration = (lastTimestamp - firstTimestamp) / 1000; // en segundos

  return {
    rssi_min: Math.round(rssi_min),
    rssi_max: Math.round(rssi_max),
    rssi_mean: Math.round(rssi_mean),
    distance: Math.round(distance * 100) / 100, // 2 decimales
    duration: Math.round(duration)
  };
}

// Obtener los últimos 5 eventos de la tabla
function getLastFiveEvents(db) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM beacon_events 
      ORDER BY f_final DESC 
      LIMIT 5
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

// Convertir evento de BD a formato API/MQTT
function convertEventToMqttFormat(event, wap) {
  // Parsear arrays RSSI
  let validRssiArray = [];

  try {
    if (event.rssi) {
      validRssiArray = JSON.parse(event.rssi);
    }
  } catch (parseErr) {
    logger.error('Error parseando RSSI:', parseErr);
  }

  // Calcular estadísticas
  const stats = calculateBeaconStats(validRssiArray);

  return {
    mac: event.beaconMac,
    unit: event.unit || UNIT,
    f_inicio: new Date(event.f_inicio).getTime(),
    f_final: new Date(event.f_final).getTime(),
    duration: stats.duration,
    rssi_min: stats.rssi_min,
    rssi_max: stats.rssi_max,
    rssi_mean: stats.rssi_mean,
    distance: stats.distance,
    uuid: event.uuid,
    connection: "offline",
    rssi: [],
    rssi_discard: [],
    wap: wap.wap || "",
    wap_mac: wap.wap_mac || "",
  };
}

// Enviar datos por MQTT
async function sendDataToMQTT() {
  try {
    // if (!mqttClient || !mqttClient.connected) {
    //   logger.warn('📡 Cliente MQTT no conectado, saltando envío');
    //   return;
    // }

    // Obtener información WiFi
    let wifiInfo = { wap: "", wap_mac: "" };
    try {
      const info = await getWifiInfo();
      wifiInfo.wap = info.ssid;
      wifiInfo.wap_mac = info.bssid;
    } catch (wifiErr) {
      logger.warn('⚠️ No se pudo obtener información WiFi:', wifiErr.message);
    }

  // Enviar datos GPS por MQTT
  function sendGPSDataToMQTT() {
    // if (!mqttClient || !mqttClient.connected) return;
    if (!lastGPSData) return;
    const payload = {
      unit: UNIT,
      timestamp: new Date().toISOString(),
      gps: lastGPSData
    };
    const message = JSON.stringify(payload, null, 2);
    // Solo imprimir el JSON generado para pruebas
    console.log('--- JSON generado para GPS MQTT ---');
    console.log(message);
    console.log('-----------------------------------');
    // mqttClient.publish(MQTT_GPS_TOPIC, message, { qos: 0 }, (err) => {
    //   if (err) {
    //     logger.error('❌ Error enviando GPS MQTT:', err.message);
    //   } else {
    //     logger.info('📡 Enviado datos GPS por MQTT');
    //   }
    // });
  }
    // Obtener los últimos 5 eventos
  // Enviar ambos datos si están disponibles
  function sendCombinedDataToMQTT() {
    // if (!mqttClient || !mqttClient.connected) return;
    if (!lastBeaconEvents.length && !lastGPSData) return;
    const payload = {
      unit: UNIT,
      timestamp: new Date().toISOString(),
      beacon: lastBeaconEvents.length ? lastBeaconEvents.map(event => convertEventToMqttFormat(event, { wap: '', wap_mac: '' })) : undefined,
      gps: lastGPSData || undefined
    };
    const message = JSON.stringify(payload, null, 2);
    // Solo imprimir el JSON generado para pruebas
    console.log('--- JSON generado para MQTT (combinado) ---');
    console.log(message);
    console.log('-------------------------------------------');
    // mqttClient.publish(MQTT_TOPIC, message, { qos: 0 }, (err) => {
    //   if (err) {
    //     logger.error('❌ Error enviando datos combinados MQTT:', err.message);
    //   } else {
    //     logger.info('📡 Enviado datos combinados por MQTT');
    //   }
    // });
  }
    const lastEvents = await getLastFiveEvents(db);

    if (lastEvents.length === 0) {
      logger.debug('📡 No hay eventos para enviar por MQTT');
      return;
    }

    // Convertir eventos al formato API
    const payload = {
      unit: UNIT,
      timestamp: new Date().toISOString(),
      count: lastEvents.length,
      wap_mac: wifiInfo.wap_mac,
      events: lastEvents.map(event => convertEventToMqttFormat(event, wifiInfo))
    };

    // Enviar por MQTT
    const message = JSON.stringify(payload, null, 2);

    // Solo imprimir el JSON generado para pruebas
    console.log('--- JSON generado para MQTT ---');
    console.log(message);
    console.log('-------------------------------');
    // mqttClient.publish(MQTT_TOPIC, message, { qos: 0 }, (err) => {
    //   if (err) {
    //     logger.error('❌ Error enviando mensaje MQTT:', err.message);
    //   } else {
    //     logger.info(`📡 Enviados ${lastEvents.length} eventos por MQTT al topic: ${MQTT_TOPIC}`);
    //   }
    // });

  } catch (error) {
    logger.error('❌ Error en sendDataToMQTT:', error.message);
  }
}

// Inicializar base de datos
function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_FILE, (err) => {
      if (err) {
        reject(err);
        return;
      }
      logger.info('📊 Base de datos conectada para MQTT');
      resolve(db);
    });
  });
}

// Inicializar cliente MQTT
function initMQTT() {
  return new Promise((resolve, reject) => {
    logger.info(`📡 Conectando a MQTT broker: ${MQTT_BROKER}`);

    mqttClient = mqtt.connect(MQTT_BROKER, mqttOptions);

    mqttClient.on('connect', () => {
      logger.info(`✅ Conectado a MQTT broker con ID: ${MQTT_CLIENT_ID}`);
      logger.info(`📡 Topic de envío: ${MQTT_TOPIC}`);
      resolve(mqttClient);
    });

    mqttClient.on('error', (err) => {
      logger.error('❌ Error MQTT:', err.message);
      reject(err);
    });

    mqttClient.on('disconnect', () => {
      logger.warn('⚠️ Desconectado del broker MQTT');
    });

    mqttClient.on('reconnect', () => {
      logger.info('🔄 Reconectando al broker MQTT...');
    });

    mqttClient.on('offline', () => {
      logger.warn('📡 Cliente MQTT offline');
    });
  });
}

// Función principal
async function startMQTTService() {
  try {
    logger.info('🚀 Iniciando servicio MQTT para beacons...');
    logger.info('⚙️ Configuración MQTT:');
    logger.info(`   Broker: ${MQTT_BROKER}`);
    logger.info(`   Topic: ${MQTT_TOPIC}`);
    logger.info(`   Client ID: ${MQTT_CLIENT_ID}`);
    logger.info(`   Intervalo: ${MQTT_INTERVAL}ms`);
    logger.info(`   Base de datos: ${DB_FILE}`);

    // Inicializar base de datos
    await initDatabase();

    // Inicializar cliente MQTT
    // await initMQTT();

    // Programar envíos cada segundo
    setInterval(() => {
      // Leer GPS
      readGPSData(() => {
        // Si hay datos de beacon y GPS, enviar ambos
        if (lastBeaconEvents.length && lastGPSData) {
          sendCombinedDataToMQTT();
        } else if (lastBeaconEvents.length) {
          sendDataToMQTT();
        } else if (lastGPSData) {
          // Definir la función antes de llamarla
          // (La función ya está definida arriba, solo asegúrate que la llamada esté después de la definición)
          sendGPSDataToMQTT();
        } else {
          logger.debug('⏳ No hay datos beacon ni GPS para enviar');
        }
      });
    }, 1000);

    logger.info('✅ Servicio MQTT iniciado correctamente');

  } catch (error) {
    logger.error('❌ Error iniciando servicio MQTT:', error.message);
    process.exit(1);
  }
}

// Manejo de cierre limpio
process.on('SIGINT', () => {
  logger.info('🛑 Cerrando servicio MQTT...');

  if (mqttClient && mqttClient.connected) {
    mqttClient.end(() => {
      logger.info('📡 Cliente MQTT cerrado');
    });
  }

  if (db) {
    db.close((err) => {
      if (err) {
        logger.error('❌ Error cerrando base de datos:', err.message);
      } else {
        logger.info('📊 Base de datos cerrada');
      }
    });
  }

  process.exit(0);
});

// Iniciar el servicio si se ejecuta directamente
if (require.main === module) {
  startMQTTService();
}

module.exports = {
  startMQTTService,
  sendDataToMQTT,
  initMQTT,
  initDatabase
};
