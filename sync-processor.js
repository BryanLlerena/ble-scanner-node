// Proceso de sincronización independiente para beacons
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { syncBeaconEvents } = require('./sync');
const logger = require('./logger');

// Configuración desde variables de entorno
const DB_FILE = process.env.DB_FILE || "beacons.db";
const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL) || 30000;
const INITIAL_SYNC_DELAY = parseInt(process.env.INITIAL_SYNC_DELAY) || 10000;

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
  } catch (error) {
    logger.error('❌ Error en sincronización:', error);
  }
}

// Configurar sincronización periódica
logger.info(`⏰ Configurando sincronización cada ${SYNC_INTERVAL}ms`);
setInterval(runSync, SYNC_INTERVAL);

// Ejecutar primera sincronización después del delay inicial
logger.info(`⏳ Primera sincronización en ${INITIAL_SYNC_DELAY}ms`);
setTimeout(runSync, INITIAL_SYNC_DELAY);

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