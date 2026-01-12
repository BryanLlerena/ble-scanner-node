// BLE Scanner usando bluetoothctl y SQLite (compatible con Yocto)
require('dotenv').config();
const { spawn, exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
// const { v4: uuidv4 } = require('uuid'); // Removido por compatibilidad ESM
// Sincronización ahora manejada por sync-processor.js
const logger = require('./logger');

// Configuración desde variables de entorno
const SCAN_RANGE = parseFloat(process.env.SCAN_RANGE) || 80;
const DEBOUNCE_TIME = parseInt(process.env.DEBOUNCE_TIME) || 300;
const TARGET_MAC_PREFIX = process.env.TARGET_MAC_PREFIX || "bc:57:29";
const UNIT = process.env.UNIT || "TEST_UNIT";
const DB_FILE = process.env.DB_FILE || "beacons.db";
// Variables de sincronización movidas a sync-processor.js
const DEBUG_DEVICES = false; // Desactivado para producción
const BEACON_TIMEOUT = parseInt(process.env.BEACON_TIMEOUT) || 3000; // 5 minutos por defecto

// Variables para bluetoothctl
let scanProcess;
let watchdogTimer;
let preventiveRestartTimer;
const detectedMACs = new Set();

logger.info('🔧 Configuración cargada');
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

  db.run(`ALTER TABLE beacon_events ADD COLUMN syncStatus TEXT DEFAULT 'pending'`, () => { });
  db.run(`ALTER TABLE beacon_events ADD COLUMN syncTimestamp DATETIME`, () => { });
  db.run(`ALTER TABLE beacon_events ADD COLUMN uuid TEXT`, () => { });
});

// Cache temporal para dispositivos detectados
// Cache removido - ahora procesamos dispositivos directamente

// Generar UUID usando crypto nativo (compatible con todos los sistemas)
function generateUUID() {
  return crypto.randomUUID() + '-' + UNIT;
}

// Calcular distancia basada en RSSI
function calculateDistance(rssi, txPower = -59) {
  if (rssi === 0) return -1;
  const n = 2.0;
  const distanceMeters = Math.pow(10, (txPower - rssi) / (10.0 * n));
  const distanceCm = distanceMeters * 100;

  if (distanceCm < 10) return 10;
  if (distanceCm > 10000) return 10000;

  return Math.round(distanceCm);
}

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
    `INSERT INTO beacon_events (deviceId, beaconMac, name, rssi, rssi_discard, timestamp, type, uuid, major, minor, txPower, namespace, instance, distance, distanceInM, eventState, f_inicio, f_final, unit, manufacturerData, serviceData, syncStatus) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 'pending')`,
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
      deviceData.serviceData
    ],
    err => {
      if (err) {
        logger.error('❌ Error guardando evento:', err);
      } else {
        const rssiCount = deviceData.distanceInM <= SCAN_RANGE ? 1 : 0;
        const rssiDiscardCount = deviceData.distanceInM > SCAN_RANGE ? 1 : 0;
        // Evento guardado correctamente
      }
    }
  );
}

// Función para actualizar evento existente
function updateBeaconEvent(deviceData, eventId) {
  const timestamp = new Date().toISOString();
  // Actualizando evento existente

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
            // Evento actualizado correctamente
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
        callback(null, row);
      }
    }
  );
}

// Función para cerrar eventos de beacons que han desaparecido (timeout)
function closeExpiredBeaconEvents() {
  const now = Date.now();
  // Verificando beacons expirados

  // Obtener todos los eventos abiertos
  db.all(
    `SELECT id, beaconMac, f_final FROM beacon_events WHERE eventState = 'open'`,
    (err, openEvents) => {
      if (err) {
        logger.error('❌ Error obteniendo eventos abiertos:', err);
        return;
      }

      if (openEvents.length === 0) {
        // No hay eventos abiertos
        return;
      }

      // Verificando eventos abiertos

      openEvents.forEach(event => {
        const lastFinalTime = new Date(event.f_final).getTime();

        // Si no hay registro de última vez visto, usar f_final del evento
        const timeToCheck = lastFinalTime;
        const timeSinceLastSeen = (now - timeToCheck) / 1000; // en segundos

        if (timeSinceLastSeen > BEACON_TIMEOUT) {
          logger.warn(`⏰ Beacon ${event.beaconMac} perdido por ${Math.round(timeSinceLastSeen)}s - cerrando evento ${event.id}`);
          closeBeaconEvent(event.id, event.beaconMac);
        } else {
          // Beacon activo
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

// Funciones de Noble removidas - ahora usamos bluetoothctl

// Parsear datos de beacon desde bluetoothctl
function parseBeaconData(line) {
  let mac, rssi = -70, deviceName = '';

  // Procesar nuevos dispositivos: [NEW] Device AA:BB:CC:DD:EE:FF Name
  if (line.includes('[NEW] Device')) {
    const newMatch = line.match(/\[NEW\] Device ([A-Fa-f0-9:]{17})(?:\s+(.*))?/);
    if (!newMatch) return null;

    mac = newMatch[1].toLowerCase();
    deviceName = newMatch[2] || 'Sin nombre';
    rssi = -60; // RSSI por defecto para nuevos dispositivos

    // Solo mostrar dispositivos objetivo
    const isTarget = mac.startsWith(TARGET_MAC_PREFIX.toLowerCase());
    if (isTarget && !detectedMACs.has(mac)) {
      detectedMACs.add(mac);

      logger.info(`🎯 Nuevo beacon detectado: ${mac.toUpperCase()} | RSSI: ${rssi} dBm`);
    }
  }
  // Procesar cambios de RSSI: [CHG] Device AA:BB:CC:DD:EE:FF RSSI: -XX
  else if (line.includes('[CHG] Device') && line.includes('RSSI:')) {
    const chgMatch = line.match(/\[CHG\] Device ([A-Fa-f0-9:]{17}).*RSSI:\s*(-?\d+)/);
    if (!chgMatch) return null;
    mac = chgMatch[1].toLowerCase();
    rssi = parseInt(chgMatch[2]);
    deviceName = 'LS_Beacon_V8.4'; // Nombre por defecto para CHG events

    // Mostrar TODAS las actualizaciones de RSSI para dispositivos objetivo
    const isTarget = mac.startsWith(TARGET_MAC_PREFIX.toLowerCase());
    if (isTarget) {
      // Beacon RSSI actualizado
    }
  }
  else {
    return null;
  }

  // Solo procesar beacons objetivo para la base de datos
  if (!mac || !mac.startsWith(TARGET_MAC_PREFIX.toLowerCase())) return null;

  const distance = calculateDistanceInM(rssi);

  return {
    deviceId: mac,
    mac,
    name: deviceName || 'BLE Device',
    rssi,
    distance,
    distanceInM: distance,
    timestamp: Date.now(),
    isBeacon: true,
    type: 'BLE',
    manufacturerData: null,
    serviceData: null
  };
}

// Función processDevice removida - bluetoothctl usa parseBeaconData directamente

// Iniciar escaneo BLE con bluetoothctl (optimizado para Yocto)
function startBLEScan() {
  logger.info('📡 Iniciando escaneo BLE con bluetoothctl...');

  // Reset completo del Bluetooth
  logger.info('🔄 Ejecutando reset de Bluetooth hci0...');
  exec('hciconfig hci0 down && sleep 1 && hciconfig hci0 up && sleep 2', (err) => {
    if (err) {
      logger.error('❌ Error reseteando hci0:', err.message);
      logger.info('🔄 Reintentando en 10 segundos...');
      setTimeout(startBLEScan, 10000);
      return;
    }

    logger.info('✅ Bluetooth reseteado correctamente');

    // Iniciar bluetoothctl
    scanProcess = spawn('bluetoothctl', [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let lastDeviceTime = Date.now();

    // Configurar bluetoothctl paso a paso
    setTimeout(() => {
      scanProcess.stdin.write('power on\n');
      logger.info('🔌 Bluetooth power on');
    }, 500);

    setTimeout(() => {
      scanProcess.stdin.write('agent on\n');
      logger.info('👤 Agent activado');
    }, 1000);

    // Filtros de bluetoothctl removidos - no compatibles con esta versión

    setTimeout(() => {
      scanProcess.stdin.write('scan on\n');
      logger.info('🔍 Escaneo BLE iniciado (sin filtros adicionales)');
      logger.info('⏰ Watchdog activado - reiniciará si no hay actividad por 120s');

      // Watchdog para detectar inactividad
      watchdogTimer = setInterval(() => {
        const timeSinceLastDevice = Date.now() - lastDeviceTime;
        const secondsSinceLastDevice = Math.floor(timeSinceLastDevice / 1000);

        logger.info(`💓 Watchdog: ${secondsSinceLastDevice}s sin actividad BLE`);

        if (timeSinceLastDevice > 120000) { // 120 segundos sin dispositivos
          logger.warn('⚠️ Sin actividad BLE por 120s - reiniciando scanner...');
          clearInterval(watchdogTimer);
          if (preventiveRestartTimer) {
            clearTimeout(preventiveRestartTimer);
          }
          if (scanProcess) {
            scanProcess.kill('SIGTERM');
          }
          setTimeout(startBLEScan, 3000);
        }
      }, 10000); // Check cada 10 segundos para más visibilidad

    }, 1500);

    scanProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      // Solo log de output si contiene dispositivos objetivo
      const containsTargetDevice = rawOutput.toLowerCase().includes(TARGET_MAC_PREFIX.toLowerCase());
      // Solo procesar output con dispositivos objetivo

      const lines = rawOutput.split('\n');

      lines.forEach((line, index) => {
        line = line.trim();
        if (!line) return;

        // Debug: mostrar líneas con dispositivos objetivo
        // Procesar líneas con dispositivos objetivo

        // Limpiar línea de caracteres de control y códigos ANSI
        const cleanLine = line
          .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remover caracteres de control
          .replace(/\x1b\[[0-9;]*[mGKH]/g, '') // Remover códigos ANSI
          .replace(/\[[0-9;]*m/g, '') // Remover códigos de color restantes
          .replace(/\[K/g, '') // Remover clear line
          .trim();

        // Solo procesar líneas de dispositivos con nuestro prefijo objetivo
        if (/\[NEW\]\s+Device/.test(cleanLine) || (/\[CHG\]\s+Device/.test(cleanLine) && cleanLine.includes('RSSI'))) {
          const macMatch = cleanLine.match(/([A-Fa-f0-9:]{17})/);

          if (macMatch && macMatch[1].toLowerCase().startsWith(TARGET_MAC_PREFIX.toLowerCase())) {
            lastDeviceTime = Date.now();

            // Parsear y procesar beacon objetivo
            const beaconData = parseBeaconData(cleanLine);
            if (beaconData) {
              logger.info(`🎯 Beacon objetivo procesado: ${macMatch[1].toUpperCase()}`);
              processDetectedDevice(beaconData);
            }
          }
        }
      });
    });

    scanProcess.stderr.on('data', (data) => {
      logger.error('❌ Error bluetoothctl:', data.toString());
    });

    scanProcess.on('close', (code) => {
      logger.warn(`🔄 Bluetoothctl cerrado (código ${code}) - reiniciando...`);
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
      }
      if (preventiveRestartTimer) {
        clearTimeout(preventiveRestartTimer);
      }
      setTimeout(startBLEScan, 8000);
    });

    // Reinicio preventivo cada 10 minutos (importante en Yocto)
    preventiveRestartTimer = setTimeout(() => {
      logger.info('🔄 Reinicio preventivo del scanner (10min)');
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
      }
      if (preventiveRestartTimer) {
        clearTimeout(preventiveRestartTimer);
      }
      if (scanProcess) {
        scanProcess.kill('SIGTERM');
      }
      setTimeout(startBLEScan, 5000);
    }, 600000); // 10 minutos
  });
}

// Función para procesar dispositivo individual (lógica de debounce)
function processDetectedDevice(device) {
  if (!device || !device.isBeacon || !device.mac.startsWith(TARGET_MAC_PREFIX.toLowerCase())) {
    return;
  }

  // Procesando dispositivo detectado

  logger.info(`🎯 Beacon detectado: ${device.name} ${device.type} | MAC=${device.mac} | RSSI=${device.rssi} | Distancia=${device.distanceInM.toFixed(2)}m`);

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

// Iniciar escaneo BLE
startBLEScan();

// Verificar beacons perdidos cada 30 segundos
setInterval(closeExpiredBeaconEvents, 30000);

// Sincronización ahora manejada por proceso independiente sync-processor.js

process.on('SIGINT', () => {
  logger.info('\n🛑 Finalizando aplicación...');

  // Detener bluetoothctl si está activo
  if (scanProcess && !scanProcess.killed) {
    logger.info('🔌 Deteniendo bluetoothctl...');
    scanProcess.kill('SIGTERM');
  }

  // Limpiar timers
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
  }
  if (preventiveRestartTimer) {
    clearTimeout(preventiveRestartTimer);
  }

  db.close((err) => {
    if (err) {
      logger.error('❌ Error cerrando base de datos:', err);
    } else {
      logger.info('✅ Base de datos cerrada correctamente.');
    }
  });

  process.exit();
});
