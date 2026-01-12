// BLE Scanner usando hcitool para tablet (sin noble)
require('dotenv').config();
const { spawn, exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const logger = require('./logger');

// Configuración
const UNIT = process.env.UNIT || "TABLET_01";
const TARGET_MAC_PREFIX = process.env.TARGET_MAC_PREFIX || "bc:57:29";
const SCAN_RANGE = parseFloat(process.env.SCAN_RANGE) || 80;
const DEBOUNCE_TIME = parseInt(process.env.DEBOUNCE_TIME) || 240;
const BEACON_TIMEOUT = parseInt(process.env.BEACON_TIMEOUT) || 360;
const DB_FILE = process.env.DB_FILE || 'beacons.db';

let db;
let scanProcess;

// Inicializar base de datos
function initDatabase() {
  db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
      logger.error('Error conectando a la base de datos:', err.message);
      process.exit(1);
    }
    logger.info('📊 Base de datos SQLite conectada');

    // Crear tabla si no existe
    db.run(`
      CREATE TABLE IF NOT EXISTS beacon_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        beaconMac TEXT NOT NULL,
        unit TEXT NOT NULL,
        f_inicio DATETIME NOT NULL,
        f_final DATETIME NOT NULL,
        rssi TEXT,
        rssi_discard TEXT,
        syncStatus TEXT DEFAULT 'pending',
        syncTimestamp DATETIME,
        uuid TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        logger.error('Error creando tabla:', err.message);
      } else {
        logger.info('✅ Tabla beacon_events lista');
      }
    });
  });
}

// Calcular distancia desde RSSI
function calculateDistance(rssi, txPower = -59) {
  if (rssi === 0) return -1.0;

  const ratio = (txPower - rssi) / 20.0;
  return Math.pow(10, ratio);
}

// Parsear datos de beacon desde hcitool
function parseBeaconData(line) {
  // Formato hcitool: "XX:XX:XX:XX:XX:XX (RSSI: -XX)"
  const match = line.match(/([0-9A-F:]{17})\s+.*RSSI:\s*(-?\d+)/i);
  if (!match) return null;

  const mac = match[1].toLowerCase();
  const rssi = parseInt(match[2]);

  // Filtrar solo nuestros beacons
  if (!mac.startsWith(TARGET_MAC_PREFIX.toLowerCase())) return null;

  const distance = calculateDistance(rssi);

  return {
    mac,
    rssi,
    distance,
    timestamp: Date.now()
  };
}

// Guardar evento de beacon
function saveBeaconEvent(beaconData) {
  const now = new Date().toISOString();
  const rssiEntry = {
    rssi: beaconData.rssi,
    distance: beaconData.distance,
    datetime: beaconData.timestamp
  };

  const rssi = beaconData.distance <= SCAN_RANGE ? JSON.stringify([rssiEntry]) : JSON.stringify([]);
  const rssi_discard = beaconData.distance > SCAN_RANGE ? JSON.stringify([rssiEntry]) : JSON.stringify([]);

  db.run(`
    INSERT INTO beacon_events (beaconMac, unit, f_inicio, f_final, rssi, rssi_discard, uuid)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    beaconData.mac,
    UNIT,
    now,
    now,
    rssi,
    rssi_discard,
    generateUUID()
  ], function (err) {
    if (err) {
      logger.error('Error guardando evento:', err.message);
    } else {
      const inRange = beaconData.distance <= SCAN_RANGE ? "✅" : "❌";
      logger.info(`${inRange} Beacon ${beaconData.mac} | RSSI: ${beaconData.rssi} | Distancia: ${beaconData.distance.toFixed(2)}m`);
    }
  });
}

// Generar UUID usando crypto nativo (compatible with todos los sistemas)
function generateUUID() {
  return crypto.randomUUID();
}

// Iniciar escaneo BLE con hcitool
function startBLEScan() {
  logger.info('📡 Iniciando escaneo BLE con hcitool...');

  // Verificar que hci0 esté activo
  exec('hciconfig hci0 up', (err) => {
    if (err) {
      logger.error('Error activando hci0:', err.message);
      return;
    }

    // Iniciar escaneo continuo
    scanProcess = spawn('hcitool', ['lescan', '--duplicates'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    scanProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');

      lines.forEach(line => {
        line = line.trim();
        if (!line || line.includes('LE Scan')) return;

        // Parsear y procesar beacon
        const beaconData = parseBeaconData(line);
        if (beaconData) {
          saveBeaconEvent(beaconData);
        }
      });
    });

    scanProcess.stderr.on('data', (data) => {
      logger.error('Error en escaneo:', data.toString());
    });

    scanProcess.on('close', (code) => {
      logger.warn(`Proceso de escaneo terminó con código ${code}`);
      // Reiniciar escaneo después de 5 segundos
      setTimeout(startBLEScan, 5000);
    });

    logger.info('✅ Escaneo BLE iniciado con hcitool');
  });
}

// Cerrar eventos antiguos
function closeExpiredEvents() {
  const expiredTime = new Date(Date.now() - (BEACON_TIMEOUT * 1000)).toISOString();

  db.run(`
    UPDATE beacon_events 
    SET syncStatus = 'pending'
    WHERE f_final < ? AND syncStatus = 'active'
  `, [expiredTime], function (err) {
    if (err) {
      logger.error('Error cerrando eventos expirados:', err.message);
    } else if (this.changes > 0) {
      logger.info(`🔒 ${this.changes} eventos cerrados por timeout`);
    }
  });
}

// Manejo de señales para cierre limpio
process.on('SIGINT', () => {
  logger.info('🛑 Cerrando aplicación...');

  if (scanProcess) {
    scanProcess.kill('SIGTERM');
  }

  if (db) {
    db.close((err) => {
      if (err) {
        logger.error('Error cerrando base de datos:', err.message);
      } else {
        logger.info('📊 Base de datos cerrada');
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Inicializar aplicación
logger.info('🚀 Iniciando BLE Scanner para tablet...');
logger.info(`📋 Configuración:`);
logger.info(`   UNIT: ${UNIT}`);
logger.info(`   TARGET_MAC_PREFIX: ${TARGET_MAC_PREFIX}`);
logger.info(`   SCAN_RANGE: ${SCAN_RANGE}m`);
logger.info(`   DB_FILE: ${DB_FILE}`);

initDatabase();

// Esperar un poco antes de iniciar el escaneo
setTimeout(() => {
  startBLEScan();

  // Limpiar eventos expirados cada 30 segundos
  setInterval(closeExpiredEvents, 30000);
}, 2000);