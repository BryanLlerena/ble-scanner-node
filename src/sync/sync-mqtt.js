let lastGPSData = null;
let lastGPSPublishTime = 0; // Control de tiempo para envíos GPS

// Servicio MQTT para envío de datos de beacons
require('dotenv').config();
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
const logger = require('../utils/logger');
const wifiUtils = require('../wifi/wifi-utils');
const { calculateSpeedKmH } = require('../utils/gps-utils');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');

const UNIT = process.env.UNIT || "TEST_UNIT";
const DB_FILE = process.env.DB_FILE || 'beacons.db';
const COMPANY = process.env.MQTT_COMPANY || 'gunjop';

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const MQTT_CLIENT_ID = `${uuidv4()}_${UNIT}`;
const MQTT_USERNAME = process.env.MQTT_USERNAME || null;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || null;
const MQTT_INTERVAL = (parseInt(process.env.MQTT_INTERVAL) || 60) * 1000;
const MQTT_TOPIC = `${COMPANY}/truck/${UNIT.toLowerCase()}/tracking`;
const MQTT_GPS_TOPIC = `${COMPANY}/truck/${UNIT.toLowerCase()}/gps`;

// Función para enviar GPS a topic separado
async function sendGPSDataToMQTT() {
  try {
    if (!mqttClient || !mqttClient.connected) {
      logger.debug('📡 Cliente MQTT no conectado, saltando envío GPS');
      return;
    }

    if (!lastGPSData) {
      logger.debug('📍 No hay datos GPS para enviar');
      return;
    }

    // Si pasaron más de 5 segundos desde la última lectura exitosa del GPS,
    // significa que perdió señal. No enviar el "fantasma" de la última ubicación.
    if (Date.now() - lastGPSData.timestamp > 5000) {
      logger.debug('📡 Señal GPS perdida, omitiendo envío MQTT de posición antigua');
      return;
    }

    // Se envía el dato actual guardado (el más reciente de esta iteración)
    lastGPSPublishTime = Date.now();

    // Obtener información WiFi en caché
    let wifiInfo = { ssid: "", bssid: "" };
    try {
      wifiInfo = await getWifiInfo();
    } catch (wifiErr) {
      logger.warn('⚠️ No se pudo obtener información WiFi:', wifiErr.message);
    }

    const payload = {
      unit: UNIT,
      timestamp: new Date().toISOString(),
      latitude: lastGPSData.latitude,
      longitude: lastGPSData.longitude,
      speed: lastGPSData.speed || 0,
      fix: lastGPSData.fix,
      wap: wifiInfo.ssid || "",
      wap_mac: wifiInfo.bssid || ""
    };

    const message = JSON.stringify(payload, null, 2);
    mqttClient.publish(MQTT_GPS_TOPIC, message, { qos: 0 }, (err) => {
      if (err) {
        logger.error('❌ Error enviando GPS MQTT:', err.message);
      } else {
        logger.info(`📍 GPS enviado por MQTT: ${MQTT_GPS_TOPIC}`);
      }
    });
  } catch (error) {
    logger.error('❌ Error en sendGPSDataToMQTT:', error.message);
  }
}


// Cliente MQTT
let mqttClient = null;
let db = null;

// Variables para almacenar datos recientes
// (lastGPSData movido arriba junto a la función de GPS)
let lastBeaconEvents = [];

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

let cachedWifiInfo = { ssid: "", bssid: "" };
let lastWifiCheck = 0;

async function getWifiInfo() {
  const now = Date.now();
  // Solo consultar el WiFi real al sistema operativo cada 60 segundos
  // para evitar bloquear el procesador de la Raspberry Pi enviando comandos
  if (now - lastWifiCheck > 60000) {
    try {
      cachedWifiInfo = await wifiUtils.getWifiInfo();
      lastWifiCheck = now;
    } catch (e) {
      logger.warn('⚠️ No se pudo obtener información WiFi en caché:', e.message);
    }
  }
  return cachedWifiInfo;
}

// Función para guardar GPS en base de datos local
function saveGPSToDatabase(gpsData) {
  const timestamp = new Date().toISOString();

  // Asegurar que exista la columna speed en la base de datos (por si es una versión anterior)
  db.run(`ALTER TABLE gps_data ADD COLUMN speed REAL`, () => {
    // Ignoramos el error si la columna ya existe

    db.run(`
      INSERT INTO gps_data (unit, latitude, longitude, speed, fix, timestamp, created, syncStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [UNIT, gpsData.latitude, gpsData.longitude, gpsData.speed || 0, gpsData.fix, timestamp, timestamp], (err) => {
      if (err) {
        logger.error('❌ Error guardando GPS en BD:', err.message);
      } else {
        logger.info(`📍 GPS guardado localmente: lat=${gpsData.latitude.toFixed(4)}, lon=${gpsData.longitude.toFixed(4)}, vel=${(gpsData.speed || 0).toFixed(1)}km/h`);
      }
    });
  });
}

// Función para leer datos GPS en segundo plano de manera continua
function startGPSReader() {
  if (gpsProcessRunning) return;
  gpsProcessRunning = true;

  logger.info('🚀 Iniciando lectura continua de GPS...');
  const gpsProcess = spawn('sh', ['/usr/bin/gps_runner.sh']);

  gpsProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.includes('GGA')) {
        const parts = line.split(',');
        if (parts[2] && parts[4] && parts[6] !== '0') {
          const lat = nmeaToDecimal(parts[2], parts[3]);
          const lon = nmeaToDecimal(parts[4], parts[5]);
          if (lat !== null && lon !== null) {

            const newGPSPoint = {
              latitude: lat,
              longitude: lon,
              fix: parts[6],
              timestamp: Date.now()
            };

            // Calcular velocidad si tenemos un punto anterior
            if (lastGPSData) {
              newGPSPoint.speed = calculateSpeedKmH(lastGPSData, newGPSPoint);
            } else {
              newGPSPoint.speed = 0; // Primer punto o reinicio
            }

            lastGPSData = newGPSPoint;

            // Guardado automático e independiente en local
            saveGPSToDatabase(lastGPSData);
          }
        }
      }
    }
  });

  gpsProcess.stderr.on('data', (data) => {
    logger.warn('GPS stderr:', data.toString());
  });

  gpsProcess.on('exit', () => {
    logger.warn('⚠️ Proceso GPS terminado. Reiniciando en 5s...');
    gpsProcessRunning = false;
    setTimeout(startGPSReader, 5000); // Intentar reiniciar si se cae
  });
}

// Variable para controlar si hay un proceso GPS en ejecución
let gpsProcessRunning = false;

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

// Obtener los últimos 2 eventos de la tabla
function getLastTwoEvents(db) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM beacon_events 
      ORDER BY f_final DESC 
      LIMIT 2
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

// Registro de las lecturas enviadas para no repetir la misma lectura
let lastSentData = {};

// Enviar beacons "en vivo" por MQTT (topic tracking) según nuevo formato
async function publishBeacons() {
  try {
    if (!mqttClient || !mqttClient.connected) {
      logger.debug('📡 Cliente MQTT no conectado, saltando envío beacons');
      return;
    }

    const liveBeaconsPath = path.join(__dirname, '../../public/live_beacons.json');
    let devices = [];
    if (fs.existsSync(liveBeaconsPath)) {
      try {
        const fileContent = fs.readFileSync(liveBeaconsPath, 'utf8');
        devices = JSON.parse(fileContent);
      } catch (parseErr) {
        logger.error('❌ Error parseando live_beacons.json:', parseErr.message);
      }
    }

    if (!devices || !devices.length) {
      logger.debug('📡 No hay datos beacon activos en el archivo. Se enviará tracking vacío.');
    }

    const now = Date.now();

    // Filtrar para enviar SOLO las lecturas nuevas y recientes
    const currentDevices = devices.filter(d => {
      const dTs = new Date(d.timestamp).getTime();
      const mac = d.mac || d.beaconMac || d.address;

      // Si la lectura es más antigua de 5 segundos, la ignoramos.
      // (El archivo live_beacons se actualiza cada 2 segs)
      if (now - dTs > 5000) {
        return false;
      }

      // Validar si la lectura es duplicada (mismo tiempo Y mismo rssi)
      const lastSent = lastSentData[mac];
      if (lastSent && lastSent.timestamp === dTs && lastSent.rssi === d.rssi) {
        return false;
      }

      return true;
    });

    if (!currentDevices.length) {
      logger.debug('📡 No hay lecturas nuevas en este momento exacto, enviando tracking vacío.');
    } else {
      // Actualizar registro de enviados comprobados
      currentDevices.forEach(d => {
        const dTs = new Date(d.timestamp).getTime();
        const mac = d.mac || d.beaconMac || d.address;
        lastSentData[mac] = {
          timestamp: dTs,
          rssi: d.rssi
        };
      });
    }
    for (const mac in lastSentData) {
      if (now - lastSentData[mac].timestamp > 60000) {
        delete lastSentData[mac];
      }
    }

    // Obtener información WiFi
    let wifiInfo = { wap: "", wap_mac: "" };
    try {
      const info = await getWifiInfo();
      wifiInfo.wap = info.ssid;
      wifiInfo.wap_mac = info.bssid;
    } catch (wifiErr) {
      logger.warn('⚠️ No se pudo obtener información WiFi:', wifiErr.message);
    }

    const payload = JSON.stringify({
      unitId: UNIT,
      count: currentDevices.length,
      devices: currentDevices.map((d) => ({
        address: d.mac || d.beaconMac || d.address,
        name: d.name || 'Unknown',
        rssi: d.rssi ?? null
      })),
      ts: new Date().toISOString(),
      wap: wifiInfo.wap || "",
      wap_mac: wifiInfo.wap_mac || ""
    });

    mqttClient.publish(MQTT_TOPIC, payload, { qos: 0 }, (err) => {
      if (err) {
        logger.error('❌ Error enviando beacons en vivo MQTT:', err.message);
      } else {
        logger.info(`📡 ${currentDevices.length} beacons en vivo enviados por MQTT: ${MQTT_TOPIC}`);
      }
    });
  } catch (error) {
    logger.error('❌ Error en publishBeacons:', error.message);
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
      // Configurar timeout y WAL mode para evitar SQLITE_BUSY
      db.configure('busyTimeout', 10000);
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 10000;
        PRAGMA synchronous = NORMAL;
      `, (pragmaErr) => {
        if (pragmaErr) {
          logger.warn('⚠️ No se pudo configurar PRAGMA:', pragmaErr.message);
        }
        logger.info('📊 Base de datos conectada para MQTT (WAL mode activado)');
        resolve(db);
      });
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
    await initMQTT();

    // Iniciar el lector GPS en segundo plano *una sola vez*
    startGPSReader();

    // Programar envíos de GPS y beacons basándose en MQTT_INTERVAL de .env
    setInterval(() => {
      // Tomar simplemente el último lastGPSData que tengamos en memoria y enviarlo
      sendGPSDataToMQTT();

      // Enviar beacons a topic tracking leyendo el JSON en vivo
      publishBeacons();
    }, MQTT_INTERVAL);

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
  publishBeacons,
  sendGPSDataToMQTT,
  initMQTT,
  initDatabase
};
