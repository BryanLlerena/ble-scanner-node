// Script para regenerar UUIDs en eventos que fallaron al sincronizar
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const DB_FILE = process.env.DB_FILE || "beacons.db";
const UNIT = process.env.UNIT || "TEST_UNIT";

console.log('🔧 Configuración:');
console.log(`   DB_FILE: ${DB_FILE}`);
console.log(`   UNIT: ${UNIT}`);

const db = new sqlite3.Database(DB_FILE);

// Generar UUID con unidad (igual que en index.js)
function generateUUID() {
  return `${uuidv4()}-${UNIT}`;
}

// Función para regenerar UUIDs de eventos que fallaron
function regenerateFailedUUIDs(options = {}) {
  return new Promise((resolve, reject) => {
    const {
      syncStatus = 'pending', // Estados a procesar: 'pending', 'failed', 'error'
      olderThanDays = null,    // Solo eventos más antiguos que X días
      specificBeacon = null,   // Solo eventos de un beacon específico
      dryRun = false          // Solo mostrar lo que se haría, sin ejecutar
    } = options;

    console.log('\n📊 Analizando eventos que necesitan nuevos UUIDs...');
    
    // Construir consulta base
    let whereConditions = [`syncStatus = ?`];
    let queryParams = [syncStatus];

    if (olderThanDays) {
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
      whereConditions.push(`f_inicio < ?`);
      queryParams.push(cutoffDate);
    }

    if (specificBeacon) {
      whereConditions.push(`beaconMac = ?`);
      queryParams.push(specificBeacon);
    }

    const selectQuery = `
      SELECT 
        id, 
        uuid, 
        beaconMac, 
        syncStatus, 
        f_inicio,
        unit
      FROM beacon_events 
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY f_inicio DESC
    `;

    db.all(selectQuery, queryParams, (err, events) => {
      if (err) {
        console.error('❌ Error consultando eventos:', err);
        reject(err);
        return;
      }

      if (events.length === 0) {
        console.log(`📋 No se encontraron eventos con syncStatus='${syncStatus}' que necesiten regeneración`);
        resolve({ processed: 0, regenerated: 0 });
        return;
      }

      console.log(`\n📋 Eventos encontrados que necesitan regeneración:`);
      console.log(`   Total: ${events.length} eventos`);
      console.log(`   SyncStatus: ${syncStatus}`);
      
      // Mostrar algunos ejemplos
      const sampleEvents = events.slice(0, 5);
      sampleEvents.forEach(event => {
        console.log(`   • ID: ${event.id} | UUID: ${event.uuid} | MAC: ${event.beaconMac} | Fecha: ${event.f_inicio}`);
      });
      
      if (events.length > 5) {
        console.log(`   ... y ${events.length - 5} más`);
      }

      if (dryRun) {
        console.log('\n🔍 MODO DRY-RUN: No se realizarán cambios reales');
        console.log(`   Se regenerarían ${events.length} UUIDs`);
        resolve({ processed: events.length, regenerated: 0, dryRun: true });
        return;
      }

      console.log('\n⚠️  Se procederá a regenerar los UUIDs para estos eventos');
      console.log('   - Se creará un nuevo UUID para cada evento');
      console.log('   - SyncStatus: pending → pending (mantiene estado)');
      console.log('   - SyncStatus: failed/error/sent → updated (para re-sincronizar)');

      // Procesar eventos en lotes para mejor rendimiento
      let processedCount = 0;
      let regeneratedCount = 0;

      const processEvents = (eventList) => {
        if (eventList.length === 0) {
          console.log(`\n✅ Regeneración completada!`);
          console.log(`   - Eventos procesados: ${processedCount}`);
          console.log(`   - UUIDs regenerados: ${regeneratedCount}`);
          resolve({ processed: processedCount, regenerated: regeneratedCount });
          return;
        }

        const event = eventList.shift();
        const newUUID = generateUUID();
        
        // Determinar el nuevo syncStatus según el estado actual
        let newSyncStatus;
        if (event.syncStatus === 'pending') {
          newSyncStatus = 'pending'; // Mantener pending
        } else {
          newSyncStatus = 'updated'; // failed, error, sent → updated
        }

        db.run(
          `UPDATE beacon_events 
           SET 
             uuid = ?,
             syncStatus = ?
           WHERE id = ?`,
          [newUUID, newSyncStatus, event.id],
          function(err) {
            processedCount++;

            if (err) {
              console.error(`❌ Error actualizando evento ${event.id}:`, err);
            } else {
              regeneratedCount++;
              const statusChange = event.syncStatus === newSyncStatus ? 
                `(mantiene ${newSyncStatus})` : 
                `(${event.syncStatus} → ${newSyncStatus})`;
              console.log(`✅ UUID regenerado para evento ${event.id}: ${event.uuid} → ${newUUID} ${statusChange}`);
            }

            // Continuar con el siguiente evento
            setTimeout(() => processEvents(eventList), 10); // Pequeña pausa
          }
        );
      };

      // Iniciar procesamiento
      processEvents([...events]);
    });
  });
}

// Función para obtener estadísticas de sincronización
function getSyncStats() {
  return new Promise((resolve, reject) => {
    console.log('\n📊 Estadísticas de sincronización:');
    
    db.all(
      `SELECT 
        syncStatus,
        COUNT(*) as cantidad,
        MIN(f_inicio) as evento_mas_antiguo,
        MAX(f_inicio) as evento_mas_reciente
       FROM beacon_events 
       GROUP BY syncStatus
       ORDER BY cantidad DESC`,
      (err, stats) => {
        if (err) {
          console.error('❌ Error obteniendo estadísticas:', err);
          reject(err);
          return;
        }

        stats.forEach(stat => {
          console.log(`   ${stat.syncStatus}: ${stat.cantidad} eventos`);
          console.log(`     └─ Desde: ${stat.evento_mas_antiguo} hasta: ${stat.evento_mas_reciente}`);
        });

        resolve(stats);
      }
    );
  });
}

// Función para verificar UUIDs duplicados
function checkDuplicateUUIDs() {
  return new Promise((resolve, reject) => {
    console.log('\n🔍 Verificando UUIDs duplicados...');
    
    db.all(
      `SELECT 
        uuid,
        COUNT(*) as cantidad
       FROM beacon_events 
       WHERE uuid IS NOT NULL
       GROUP BY uuid
       HAVING COUNT(*) > 1
       ORDER BY cantidad DESC`,
      (err, duplicates) => {
        if (err) {
          console.error('❌ Error verificando duplicados:', err);
          reject(err);
          return;
        }

        if (duplicates.length === 0) {
          console.log('✅ No se encontraron UUIDs duplicados');
        } else {
          console.log(`⚠️  Se encontraron ${duplicates.length} UUIDs duplicados:`);
          duplicates.forEach(dup => {
            console.log(`   UUID: ${dup.uuid} (${dup.cantidad} veces)`);
          });
        }

        resolve(duplicates);
      }
    );
  });
}

// Ejecutar el script
async function main() {
  const args = process.argv.slice(2);
  
  try {
    console.log('🚀 Iniciando regeneración de UUIDs para eventos fallidos...\n');
    
    // Mostrar estadísticas actuales
    await getSyncStats();
    await checkDuplicateUUIDs();

    // Opciones de configuración
    const options = {
      syncStatus: 'pending', // Cambiar según necesidad: 'pending', 'failed', 'error'
      dryRun: args.includes('--dry-run') || args.includes('-d')
    };

    // Procesar argumentos adicionales
    if (args.includes('--failed')) {
      options.syncStatus = 'failed';
    }
    if (args.includes('--error')) {
      options.syncStatus = 'error';
    }
    if (args.includes('--older-than')) {
      const daysIndex = args.indexOf('--older-than') + 1;
      if (daysIndex < args.length) {
        options.olderThanDays = parseInt(args[daysIndex]);
      }
    }
    if (args.includes('--beacon')) {
      const beaconIndex = args.indexOf('--beacon') + 1;
      if (beaconIndex < args.length) {
        options.specificBeacon = args[beaconIndex];
      }
    }

    console.log(`\n🔄 Configuración de regeneración:`);
    console.log(`   SyncStatus objetivo: ${options.syncStatus}`);
    console.log(`   Modo dry-run: ${options.dryRun ? 'SÍ' : 'NO'}`);
    if (options.olderThanDays) console.log(`   Solo eventos más antiguos que: ${options.olderThanDays} días`);
    if (options.specificBeacon) console.log(`   Solo beacon: ${options.specificBeacon}`);

    // Ejecutar regeneración
    const result = await regenerateFailedUUIDs(options);
    
    if (!options.dryRun && result.regenerated > 0) {
      console.log('\n📊 Estadísticas finales:');
      await getSyncStats();
      
      console.log('\n🎯 Recomendaciones:');
      console.log('   1. Los eventos con UUIDs regenerados se sincronizarán automáticamente');
      console.log('   2. Verifica los logs del sincronizador para confirmar el éxito');
      console.log('   3. Puedes ejecutar este script en modo dry-run (-d) para probar primero');
    }
    
  } catch (error) {
    console.error('\n❌ Error durante el proceso:', error.message);
    process.exit(1);
  } finally {
    db.close((err) => {
      if (err) {
        console.error('❌ Error cerrando base de datos:', err);
      } else {
        console.log('\n🔐 Base de datos cerrada correctamente.');
      }
      process.exit(0);
    });
  }
}

// Mostrar ayuda
function showHelp() {
  console.log(`
🔄 Regenerador de UUIDs para eventos fallidos

Uso: node regenerate-uuids.js [opciones]

Opciones:
  --dry-run, -d          Solo mostrar lo que se haría, sin ejecutar cambios
  --failed              Procesar eventos con syncStatus='failed'
  --error               Procesar eventos con syncStatus='error'
  --older-than <días>   Solo eventos más antiguos que X días
  --beacon <MAC>        Solo eventos de un beacon específico
  --help, -h            Mostrar esta ayuda

Ejemplos:
  node regenerate-uuids.js --dry-run
  node regenerate-uuids.js --failed
  node regenerate-uuids.js --older-than 7
  node regenerate-uuids.js --beacon BC:57:29:XX:XX:XX
  node regenerate-uuids.js --failed --older-than 3 --dry-run
`);
}

// Ejecutar si se llama directamente
if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  main();
}

module.exports = { regenerateFailedUUIDs, getSyncStats, checkDuplicateUUIDs };