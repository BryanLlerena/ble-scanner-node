// Proceso de sincronización independiente para beacons y GPS
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { syncBeaconEvents, syncGPSData } = require('./sync');
const logger = require('../utils/logger');

// Configuración desde variables de entorno
const DB_FILE = process.env.DB_FILE || "beacons.db";
const SYNC_INTERVAL = (parseInt(process.env.SYNC_INTERVAL) || 30) * 1000;
const INITIAL_SYNC_DELAY = (parseInt(process.env.INITIAL_SYNC_DELAY) || 10) * 1000;

logger.info('🔄 Iniciando proceso de sincronización independiente');
logger.info('🔧 Configuración de sincronización:');
logger.info(`   DB_FILE: ${DB_FILE}`);
logger.info(`   SYNC_INTERVAL: ${SYNC_INTERVAL}ms`);
logger.info(`   INITIAL_SYNC_DELAY: ${INITIAL_SYNC_DELAY}ms`);

// Conectar a la base de datos
const db = new sqlite3.Database(DB_FILE);

// Función para sincronizar eventos
async function runSync() {
  try {
    await syncBeaconEvents(db);
    await syncGPSData(db);
  } catch (error) {
    logger.error('❌ Error en sincronización:', error);
  }
}

// Función para limpiar datos antiguos enviados (older than 7 days)
function cleanupOldSentData() {
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  // Limpiar beacons antiguos
  db.run(`
    DELETE FROM beacon_events 
    WHERE syncStatus = 'sent' AND created < ?
  `, [sevenDaysAgo], function (err) {
    if (err) {
      logger.error('❌ Error limpiando beacons antiguos:', err);
    } else if (this.changes > 0) {
      logger.info(`🧹 Limpieza: ${this.changes} beacons antiguos eliminados`);
    }
  });

  // Limpiar GPS antiguos
  db.run(`
    DELETE FROM gps_data 
    WHERE syncStatus = 'sent' AND created < ?
  `, [sevenDaysAgo], function (err) {
    if (err) {
      logger.error('❌ Error limpiando GPS antiguos:', err);
    } else if (this.changes > 0) {
      logger.info(`🧹 Limpieza: ${this.changes} registros GPS antiguos eliminados`);
    }
  });
}

// Configurar sincronización periódica
logger.info(`⏰ Configurando sincronización cada ${SYNC_INTERVAL}ms`);
setInterval(runSync, SYNC_INTERVAL);

// Ejecutar primera sincronización después del delay inicial
logger.info(`⏳ Primera sincronización en ${INITIAL_SYNC_DELAY}ms`);
setTimeout(runSync, INITIAL_SYNC_DELAY);

// Configurar limpieza semanal de datos antiguos enviados
const CLEANUP_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 días en milisegundos
logger.info(`🧹 Configurando limpieza semanal de datos antiguos`);
setInterval(cleanupOldSentData, CLEANUP_INTERVAL);

// Ejecutar primera limpieza después de 1 hora
setTimeout(cleanupOldSentData, 60 * 60 * 1000);

// Manejar cierre graceful
process.on('SIGINT', () => {
  logger.info('🛑 Cerrando proceso de sincronización...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('🛑 Cerrando proceso de sincronización...');
  db.close();
  process.exit(0);
});

logger.info('✅ Proceso de sincronización iniciado correctamente');