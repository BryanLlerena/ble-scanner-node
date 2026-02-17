// BLE Scanner para Raspberry Pi usando noble y SQLite
require('dotenv').config();
const noble = require('@abandonware/noble');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
// Sincronización ahora manejada por sync-processor.js
const logger = require('./logger');

// Configuración desde variables de entorno
const SCAN_RANGE = parseFloat(process.env.SCAN_RANGE) || 80;
const DEBOUNCE_TIME = parseInt(process.env.DEBOUNCE_TIME) || 300;
const TARGET_MAC_PREFIX = process.env.TARGET_MAC_PREFIX || "bc:57:29";
const UNIT = process.env.UNIT || "TEST_UNIT";
const DB_FILE = process.env.DB_FILE || "beacons.db";
// Variables de sincronización movidas a sync-processor.js
const DEBUG_DEVICES = process.env.DEBUG_DEVICES === 'true';
const BEACON_TIMEOUT = parseInt(process.env.BEACON_TIMEOUT) || 3000; // 5 minutos por defecto

logger.info('🔧 Configuración cargada:');
logger.info(`   SCAN_RANGE: ${SCAN_RANGE}m`);
logger.info(`   DEBOUNCE_TIME: ${DEBOUNCE_TIME}s`);
logger.info(`   TARGET_MAC_PREFIX: ${TARGET_MAC_PREFIX}`);
logger.info(`   UNIT: ${UNIT}`);
// SYNC_INTERVAL ahora en sync-processor.js
logger.info(`   DB_FILE: ${DB_FILE}`);
logger.info(`   BEACON_TIMEOUT: ${BEACON_TIMEOUT}s`);

// Configuración de la base de datos
const db = new sqlite3.Database(DB_FILE);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS beacon_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deviceId TEXT,
    beaconMac TEXT,
    name TEXT,
    rssi TEXT,
    rssi_discard TEXT,
    timestamp TEXT,
    type TEXT,
    uuid TEXT,
    major INTEGER,
    minor INTEGER,
    txPower INTEGER,
    namespace TEXT,
    instance TEXT,
    distance REAL,
    distanceInM REAL,
    eventState TEXT DEFAULT 'open',
    f_inicio TEXT,
    f_final TEXT,
    unit TEXT,
    manufacturerData TEXT,
    serviceData TEXT
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_beacon_mac ON beacon_events(beaconMac)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_state ON beacon_events(eventState)`);
  db.run(`ALTER TABLE beacon_events ADD COLUMN syncStatus TEXT DEFAULT 'pending'`, () => {});
  db.run(`ALTER TABLE beacon_events ADD COLUMN syncTimestamp DATETIME`, () => {});
  db.run(`ALTER TABLE beacon_events ADD COLUMN uuid TEXT`, () => {});
  db.run(`ALTER TABLE beacon_events ADD COLUMN created TEXT`, () => {});

  // Tabla GPS separada
  db.run(`CREATE TABLE IF NOT EXISTS gps_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit TEXT,
    latitude REAL,
    longitude REAL,
    fix TEXT,
    timestamp TEXT,
    created TEXT,
    syncStatus TEXT DEFAULT 'pending',
    syncTimestamp TEXT
  )`);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_gps_syncStatus ON gps_data(syncStatus)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gps_created ON gps_data(created)`);
});

// Cache temporal para dispositivos detectados
const detectedDevicesCache = new Map();
const liveBeaconsMap = new Map();

// Generar UUID usando librería uuid + nombre de unidad
function generateUUID() {
  return `${uuidv4()}-${UNIT}`;
}

// Calcular distancia basada en RSSI (en Metros)
// Calcular distancia basada en RSSI (en Centímetros para BD)
function calculateDistance(rssi, txPower = -59) {
  if (rssi === 0) return -1;
  const n = 2.0;
  const distanceMeters = Math.pow(10, (txPower - rssi) / (10.0 * n));
  const distanceCm = distanceMeters * 100;

  if (distanceCm < 10) return 10;
  if (distanceCm > 10000) return 10000;

  return Math.round(distanceCm);
}

// Helper para tener metros si se necesita
function calculateDistanceInM(rssi, txPower = -59) {
  if (rssi === 0) return -1;
  const n = 2.0;
  return Math.pow(10, (txPower - rssi) / (10.0 * n));
}


// Función para guardar evento de beacon
function saveBeaconEvent(deviceData) {
  const timestamp = new Date().toISOString();
  const eventUuid = generateUUID();
  logger.info(`💾 Guardando nuevo evento para beacon: ${deviceData.mac}`, { uuid: eventUuid });

  const rssiEntry = {
    rssi: deviceData.rssi || 0,
    datetime: Date.now(),
    distance: deviceData.distanceInM
  };

  const rssi = deviceData.distanceInM <= SCAN_RANGE ? JSON.stringify([rssiEntry]) : JSON.stringify([]);
  const rssi_discard = deviceData.distanceInM > SCAN_RANGE ? JSON.stringify([rssiEntry]) : JSON.stringify([]);

  db.run(
    `INSERT INTO beacon_events (deviceId, beaconMac, name, rssi, rssi_discard, timestamp, type, uuid, major, minor, txPower, namespace, instance, distance, distanceInM, eventState, f_inicio, f_final, unit, manufacturerData, serviceData, syncStatus, created) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      deviceData.deviceId,
      deviceData.mac,
      deviceData.name,
      rssi,
      rssi_discard,
      timestamp,
      deviceData.type,
      eventUuid,
      deviceData.major,
      deviceData.minor,
      deviceData.txPower,
      deviceData.namespace,
      deviceData.instance,
      deviceData.distance,
      deviceData.distanceInM,
      timestamp,
      timestamp,
      UNIT,
      deviceData.manufacturerData,
      deviceData.serviceData,
      timestamp
    ],
    err => {
      if (err) {
        logger.error('❌ Error guardando evento:', err);
      } else {
        const rssiCount = deviceData.distanceInM <= SCAN_RANGE ? 1 : 0;
        const rssiDiscardCount = deviceData.distanceInM > SCAN_RANGE ? 1 : 0;
        logger.debug(`✅ Evento guardado para beacon ${deviceData.mac} | RSSI entries: ${rssiCount} | RSSI_discard entries: ${rssiDiscardCount}`);
      }
    }
  );
}

// Función para actualizar evento existente
function updateBeaconEvent(deviceData, eventId) {
  const timestamp = new Date().toISOString();
  logger.debug(`🔄 Actualizando evento ${eventId} para beacon: ${deviceData.mac}`);

  // Primero obtener arrays actuales para agregar nueva entrada
  db.get(
    `SELECT rssi, rssi_discard FROM beacon_events WHERE id = ?`,
    [eventId],
    (err, row) => {
      if (err) {
        logger.error('❌ Error obteniendo arrays actuales:', err);
        return;
      }

      // Parsear arrays actuales (o crear vacíos si es NULL)
      let currentRssiArray = [];
      let currentRssiDiscardArray = [];

      try {
        currentRssiArray = row.rssi ? JSON.parse(row.rssi) : [];
        currentRssiDiscardArray = row.rssi_discard ? JSON.parse(row.rssi_discard) : [];
      } catch (parseErr) {
        logger.error('❌ Error parseando arrays JSON:', parseErr);
        currentRssiArray = [];
        currentRssiDiscardArray = [];
      }

      // Crear nueva entrada
      const newRssiEntry = {
        rssi: deviceData.rssi || 0,
        datetime: Date.now(),
        distance: deviceData.distanceInM
      };

      // Agregar nueva entrada al array correspondiente según distancia
      if (deviceData.distanceInM <= SCAN_RANGE) {
        currentRssiArray.push(newRssiEntry);
      } else {
        currentRssiDiscardArray.push(newRssiEntry);
      }

      // Actualizar evento con arrays actualizados
      db.run(
        `UPDATE beacon_events SET rssi = ?, rssi_discard = ?, timestamp = ?, distance = ?, distanceInM = ?, 
         f_final = CASE 
           WHEN ? <= ? THEN ? 
           ELSE f_final 
         END,
         syncStatus = CASE 
           WHEN syncStatus = 'sent' THEN 'updated' 
           ELSE syncStatus 
         END
         WHERE id = ?`,
        [
          JSON.stringify(currentRssiArray),
          JSON.stringify(currentRssiDiscardArray),
          timestamp,
          deviceData.distance,
          deviceData.distanceInM,
          deviceData.distanceInM, // Parámetro para comparación
          SCAN_RANGE, // Rango válido
          timestamp, // Nuevo f_final solo si está en rango
          eventId
        ],
        err => {
          if (err) {
            logger.error('❌ Error actualizando evento:', err);
          } else {
            const finalUpdateMsg = deviceData.distanceInM <= SCAN_RANGE ? " | f_final actualizado" : " | f_final sin cambios (fuera de rango)";
            logger.debug(`✅ Evento ${eventId} actualizado | RSSI entries: ${currentRssiArray.length} | RSSI_discard entries: ${currentRssiDiscardArray.length}${finalUpdateMsg}`);
          }
        }
      );
    }
  );
}

// Función para cerrar evento
function closeBeaconEvent(eventId, deviceMac) {
  logger.info(`🔒 Cerrando evento ${eventId} para beacon: ${deviceMac}`);

  db.run(
    `UPDATE beacon_events SET eventState = 'closed', syncStatus = CASE 
       WHEN syncStatus = 'sent' THEN 'updated' 
       ELSE syncStatus 
     END WHERE id = ?`,
    [eventId],
    err => {
      if (err) {
        logger.error('❌ Error cerrando evento:', err);
      } else {
        logger.info(`✅ Evento ${eventId} cerrado`);
      }
    }
  );
}

// Función para obtener evento abierto por MAC (solo últimos 12 horas)
function getOpenEventByMac(mac, callback) {
  // Calcular timestamp de hace 1 hora
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  db.get(
    `SELECT * FROM beacon_events 
     WHERE beaconMac = ? 
     AND eventState = 'open' 
     AND f_inicio >= ? 
     ORDER BY id DESC 
     LIMIT 1`,
    [mac, oneHourAgo],
    (err, row) => {
      if (err) {
        logger.error('❌ Error buscando evento abierto:', err);
        callback(err, null);
      } else {
        logger.debug(`🔍 Evento abierto encontrado para ${mac} (últimos 2min):`, row ? `ID ${row.id}` : 'ninguno');
        callback(null, row);
      }
    }
  );
}

// Función para cerrar eventos de beacons que han desaparecido (timeout)
function closeExpiredBeaconEvents() {
  const now = Date.now();
  logger.debug('🕐 Verificando beacons expirados...');

  // Obtener todos los eventos abiertos
  db.all(
    `SELECT id, beaconMac, f_final FROM beacon_events WHERE eventState = 'open'`,
    (err, openEvents) => {
      if (err) {
        logger.error('❌ Error obteniendo eventos abiertos:', err);
        return;
      }

      if (openEvents.length === 0) {
        logger.debug('📋 No hay eventos abiertos para verificar');
        return;
      }

      logger.debug(`📋 Verificando ${openEvents.length} eventos abiertos...`);

      openEvents.forEach(event => {
        const lastFinalTime = new Date(event.f_final).getTime();

        // Si no hay registro de última vez visto, usar f_final del evento
        const timeToCheck = lastFinalTime;
        const timeSinceLastSeen = (now - timeToCheck) / 1000; // en segundos

        if (timeSinceLastSeen > BEACON_TIMEOUT) {
          logger.warn(`⏰ Beacon ${event.beaconMac} perdido por ${Math.round(timeSinceLastSeen)}s - cerrando evento ${event.id}`);
          closeBeaconEvent(event.id, event.beaconMac);
        } else {
          logger.debug(`✅ Beacon ${event.beaconMac} OK - última actividad hace ${Math.round(timeSinceLastSeen)}s`);
        }
      });
    }
  );
}

// Parsear iBeacon
function parseIBeacon(manufacturerData) {
  if (!manufacturerData || manufacturerData.length < 25) return null;

  if (manufacturerData[0] === 0x4c && manufacturerData[1] === 0x00 &&
    manufacturerData[2] === 0x02 && manufacturerData[3] === 0x15) {

    const uuidArr = manufacturerData.slice(4, 20);
    const uuid = `${uuidArr.slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('')}-` +
      `${uuidArr.slice(4, 6).map(b => b.toString(16).padStart(2, '0')).join('')}-` +
      `${uuidArr.slice(6, 8).map(b => b.toString(16).padStart(2, '0')).join('')}-` +
      `${uuidArr.slice(8, 10).map(b => b.toString(16).padStart(2, '0')).join('')}-` +
      `${uuidArr.slice(10, 16).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    const major = (manufacturerData[20] << 8) | manufacturerData[21];
    const minor = (manufacturerData[22] << 8) | manufacturerData[23];

    const txPowerRaw = manufacturerData[24];
    const txPower = txPowerRaw > 127 ? txPowerRaw - 256 : txPowerRaw;

    return { type: 'iBeacon', uuid, major, minor, txPower };
  }
  return null;
}

// Parsear Eddystone
function parseEddystone(serviceData) {
  if (!serviceData) return null;

  // Buscar el servicio Eddystone (FEAA)
  for (let uuid in serviceData) {
    if (uuid.toLowerCase().includes('feaa')) {
      const data = serviceData[uuid];
      if (data && data.length > 0 && data[0] === 0x00) { // Frame type UID
        const namespace = data.slice(2, 12).map(b => b.toString(16).padStart(2, '0')).join('');
        const instance = data.slice(12, 18).map(b => b.toString(16).padStart(2, '0')).join('');
        return { type: 'Eddystone-UID', namespace, instance };
      }
    }
  }
  return null;
}

// Procesar datos de beacon
function processDevice(peripheral) {
  let beaconInfo = parseIBeacon(peripheral.advertisement.manufacturerData);

  if (!beaconInfo) {
    beaconInfo = parseEddystone(peripheral.advertisement.serviceData);
  }

  const txPower = beaconInfo?.txPower || -59;
  const distance = calculateDistance(peripheral.rssi || -100, txPower);
  const distanceInM = calculateDistanceInM(peripheral.rssi || -100, txPower);

  return {
    deviceId: peripheral.id,
    name: peripheral.advertisement.localName || null,
    mac: peripheral.address,
    rssi: peripheral.rssi,
    type: beaconInfo ? beaconInfo.type : 'BLE',
    uuid: beaconInfo?.uuid || null,
    major: beaconInfo?.major || null,
    minor: beaconInfo?.minor || null,
    txPower: beaconInfo?.txPower || null,
    namespace: beaconInfo?.namespace || null,
    instance: beaconInfo?.instance || null,
    distance: distance,
    distanceInM: distanceInM,
    manufacturerData: peripheral.advertisement.manufacturerData ?
      peripheral.advertisement.manufacturerData.toString('hex') : null,
    serviceData: peripheral.advertisement.serviceData ?
      JSON.stringify(peripheral.advertisement.serviceData) : null,
    isBeacon: !!beaconInfo
  };
}

// Escaneo BLE
noble.on('stateChange', state => {
  if (state === 'poweredOn') {
    noble.startScanning([], true);
    logger.info('📡 Escaneo BLE iniciado...');
  } else {
    noble.stopScanning();
    logger.warn(`⏸️ Escaneo BLE detenido. Estado: ${state}`);
  }
});

noble.on('discover', peripheral => {
  const deviceData = processDevice(peripheral);

  // Debug: Mostrar todos los dispositivos BLE detectados (controlado por variable de entorno)
  if (DEBUG_DEVICES) {
    logger.debug(`🔍 DEBUG - Dispositivo detectado:`);
    logger.debug(`   ID: ${peripheral.deviceId}`);
    logger.debug(`   MAC: ${deviceData.mac}`);
    logger.debug(`   Nombre: ${deviceData.name || 'Sin nombre'}`);
    logger.debug(`   RSSI: ${deviceData.rssi}`);
    logger.debug(`   Es Beacon: ${deviceData.isBeacon}`);
    logger.debug(`   Tipo: ${deviceData.type}`);
    logger.debug(`   ManufacturerData: ${deviceData.manufacturerData || 'Ninguno'}`);
    logger.debug(`   ServiceData: ${deviceData.serviceData || 'Ninguno'}`);
    logger.debug(`   Cumple MAC filter: ${deviceData.mac.startsWith(TARGET_MAC_PREFIX)}`);
    logger.debug('   ---');
  }

  // Solo procesar beacons con MAC específica (igual que tu condicional React Native)
  if (deviceData.isBeacon && deviceData.mac.startsWith(TARGET_MAC_PREFIX)) {
    detectedDevicesCache.set(deviceData.deviceId, deviceData);

    // Actualizar mapa en vivo (sin filtro de distancia, solo MAC)
    liveBeaconsMap.set(deviceData.mac, {
      ...deviceData,
      lastSeen: Date.now()
    });

    logger.info(`🎯 Beacon detectado: ${deviceData.name} ${deviceData.type} | MAC=${deviceData.mac} | RSSI=${deviceData.rssi} | Distancia=${deviceData.distance}cm`);
  }
});

// Función para procesar dispositivos acumulados (similar a tu lógica React Native)
function processDetectedDevices() {
  if (detectedDevicesCache.size === 0) return;

  logger.debug(`📊 Procesando ${detectedDevicesCache.size} dispositivos acumulados...`);

  for (const [deviceId, device] of detectedDevicesCache) {
    if (device.isBeacon && device.mac.startsWith(TARGET_MAC_PREFIX)) {
      getOpenEventByMac(device.mac, (err, currentEvent) => {
        if (err) {
          logger.error('❌ Error consultando evento:', err);
          return;
        }

        if (currentEvent) {
          const timeSinceLastUpdate = (Date.now() - new Date(currentEvent.f_final).getTime()) / 1000;
          if (timeSinceLastUpdate < DEBOUNCE_TIME) {
            // Dentro del tiempo de gracia - actualizar siempre
            updateBeaconEvent(device, currentEvent.id);
          } else {
            closeBeaconEvent(currentEvent.id, device.mac);
            if (device.distanceInM <= SCAN_RANGE) {
              saveBeaconEvent(device);
            }
          }
        } else if (device.distanceInM <= SCAN_RANGE) {
          saveBeaconEvent(device);
        }
      });
    }
  }

  // Limpiar cache después de procesar
  detectedDevicesCache.clear();
  logger.debug('✅ Dispositivos procesados y cache limpiado');
}

setInterval(processDetectedDevices, 1000);

// Verificar beacons perdidos cada 30 segundos
setInterval(closeExpiredBeaconEvents, 30000);

// Sincronización ahora manejada por proceso independiente sync-processor.js

process.on('SIGINT', () => {
  logger.info('\n🛑 Finalizando aplicación...');
  db.close((err) => {
    if (err) {
      logger.error('❌ Error cerrando base de datos:', err);
    } else {
      logger.info('✅ Base de datos cerrada correctamente.');
    }
  });
  noble.stopScanning();
  process.exit();
});

// --- LIVE DUMP LOOP ---
const LIVE_DUMP_FILE = path.join(__dirname, 'public', 'live_beacons.json');
if (!fs.existsSync(path.join(__dirname, 'public'))) {
  try { fs.mkdirSync(path.join(__dirname, 'public')); } catch (e) { }
}

setInterval(() => {
  const now = Date.now();
  const liveList = [];

  // Filtrar y limpiar mapa
  for (const [mac, device] of liveBeaconsMap) {
    if (now - device.lastSeen > 10000) { // 10s timeout
      liveBeaconsMap.delete(mac);
    } else {
      liveList.push({
        beaconMac: device.mac,
        rssi: device.rssi,
        distance: device.distanceInM.toFixed(2),
        eventState: 'active', // Simulado para compatibilidad
        timestamp: new Date(device.lastSeen).toISOString(),
        txPower: device.txPower
      });
    }
  }

  fs.writeFile(LIVE_DUMP_FILE, JSON.stringify(liveList, null, 2), (err) => {
    if (err) console.error('Error writing live dump:', err.message);
  });
}, 2000); // Actualizar archivo cada 2s
