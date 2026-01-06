// BLE Scanner - MODO HÍBRIDO: Qt Scanner + Node.js Services  
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const logger = require('./logger');

// Configuración desde variables de entorno
const BEACON_TIMEOUT = parseInt(process.env.BEACON_TIMEOUT) || 3000;
const DB_FILE = process.env.DB_FILE || "beacons.db";

logger.info('🔀 MODO HÍBRIDO: Qt Scanner + Node.js Services');
logger.info('   📡 Scanning BLE: Qt Scanner (nativo)');
logger.info('   🔧 Node.js: Timeouts, stats, monitoreo');
logger.info(`   💾 DB_FILE: ${DB_FILE}`);
logger.info(`   ⏱️  BEACON_TIMEOUT: ${BEACON_TIMEOUT}s`);

// Configuración de la base de datos (compartida con Qt Scanner)
const db = new sqlite3.Database(DB_FILE);

// Verificar que la tabla existe (creada por Qt Scanner)
db.serialize(() => {
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='beacon_events'", (err, row) => {
    if (err) {
      logger.error('❌ Error verificando DB:', err);
    } else if (row) {
      logger.info('✅ Tabla beacon_events encontrada - Compatible con Qt');
    } else {
      logger.warn('⚠️ Tabla beacon_events no encontrada - ¿Qt Scanner corriendo?');
    }
  });
});

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
        logger.info(`✅ Evento ${eventId} cerrado por timeout`);
      }
    }
  );
}

// Función para cerrar eventos de beacons que han desaparecido (timeout)
function closeExpiredBeaconEvents() {
  const now = Date.now();
  
  db.all(
    `SELECT id, beaconMac, f_final FROM beacon_events WHERE eventState = 'open'`,
    (err, openEvents) => {
      if (err) {
        logger.error('❌ Error obteniendo eventos abiertos:', err);
        return;
      }
      
      if (openEvents.length === 0) {
        return;
      }
      
      openEvents.forEach(event => {
        const lastFinalTime = new Date(event.f_final).getTime();
        const timeSinceLastSeen = (now - lastFinalTime) / 1000; // en segundos
        
        if (timeSinceLastSeen > BEACON_TIMEOUT) {
          logger.warn(`⏰ Beacon ${event.beaconMac} perdido por ${Math.round(timeSinceLastSeen)}s - cerrando evento ${event.id}`);
          closeBeaconEvent(event.id, event.beaconMac);
        }
      });
    }
  );
}

// Función para mostrar estadísticas de la DB
function showDatabaseStats() {
  db.get(
    `SELECT 
       COUNT(*) as total,
       COUNT(CASE WHEN eventState = 'open' THEN 1 END) as open_events,
       COUNT(CASE WHEN DATE(timestamp) = DATE('now') THEN 1 END) as today_events,
       COUNT(CASE WHEN syncStatus = 'pending' THEN 1 END) as pending_sync
     FROM beacon_events`,
    (err, stats) => {
      if (err) {
        logger.error('❌ Error obteniendo estadísticas:', err);
        return;
      }
      
      logger.info('📊 Stats DB: Total=' + stats.total + 
                  ', Abiertos=' + stats.open_events + 
                  ', Hoy=' + stats.today_events + 
                  ', Pendientes=' + stats.pending_sync);
    }
  );
}

// Función para verificar si Qt Scanner está escribiendo a la DB
function checkQtScannerActivity() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  db.get(
    `SELECT COUNT(*) as recent_count FROM beacon_events WHERE timestamp >= ?`,
    [fiveMinutesAgo],
    (err, result) => {
      if (err) {
        logger.error('❌ Error verificando actividad Qt:', err);
        return;
      }
      
      if (result.recent_count > 0) {
        logger.info(`✅ Qt Scanner activo - ${result.recent_count} eventos en últimos 5min`);
      } else {
        logger.warn('⚠️ Qt Scanner inactivo - No hay eventos recientes');
      }
    }
  );
}

// Iniciar servicios híbridos
function startHybridServices() {
  logger.info('🚀 Iniciando servicios Node.js híbridos...');
  
  // Verificar eventos expirados cada 30 segundos
  setInterval(closeExpiredBeaconEvents, 30000);
  
  // Mostrar estadísticas cada 5 minutos
  setInterval(showDatabaseStats, 5 * 60 * 1000);
  
  // Verificar actividad Qt cada 2 minutos
  setInterval(checkQtScannerActivity, 2 * 60 * 1000);
  
  // Estadísticas iniciales
  setTimeout(showDatabaseStats, 2000);
  setTimeout(checkQtScannerActivity, 5000);
  
  logger.info('✅ Servicios híbridos iniciados:');
  logger.info('   🔒 Cierre de eventos expirados (30s)');
  logger.info('   📊 Estadísticas de DB (5min)');
  logger.info('   🔍 Monitor actividad Qt (2min)');
}

// Manejo de señales para cierre limpio
process.on('SIGINT', () => {
  logger.info('\n🛑 Finalizando servicios Node.js híbridos...');
  
  db.close((err) => {
    if (err) {
      logger.error('❌ Error cerrando base de datos:', err);
    } else {
      logger.info('✅ Base de datos cerrada correctamente');
    }
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logger.info('🔄 SIGTERM recibido - cerrando servicios...');
  db.close();
  process.exit(0);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  logger.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Promise rechazada no manejada:', reason);
});

// Iniciar servicios híbridos
startHybridServices();

// Exportar funciones para uso en otros módulos
module.exports = {
  closeBeaconEvent,
  showDatabaseStats,
  checkQtScannerActivity
};