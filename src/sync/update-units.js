// Script para actualizar todas las unidades en la base de datos
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();

const DB_FILE = process.env.DB_FILE || "beacons.db";
const UNIT = process.env.UNIT || "TEST_UNIT";

console.log('🔧 Configuración:');
console.log(`   DB_FILE: ${DB_FILE}`);
console.log(`   NUEVA_UNIT: ${UNIT}`);

const db = new sqlite3.Database(DB_FILE);

function updateAllUnits() {
  return new Promise((resolve, reject) => {
    console.log('\n📊 Obteniendo estadísticas actuales...');
    
    // Primero obtener estadísticas
    db.all(
      `SELECT 
        COUNT(*) as total_eventos,
        COUNT(DISTINCT unit) as unidades_diferentes,
        unit,
        COUNT(*) as cantidad_por_unidad
       FROM beacon_events 
       WHERE unit IS NOT NULL 
       GROUP BY unit`,
      (err, stats) => {
        if (err) {
          console.error('❌ Error obteniendo estadísticas:', err);
          reject(err);
          return;
        }

        console.log('\n📋 Estadísticas actuales:');
        if (stats.length === 0) {
          console.log('   No hay eventos con unidad definida');
        } else {
          stats.forEach(stat => {
            console.log(`   Unidad "${stat.unit}": ${stat.cantidad_por_unidad} eventos`);
          });
        }

        // Obtener total de eventos
        db.get('SELECT COUNT(*) as total FROM beacon_events', (err, totalResult) => {
          if (err) {
            console.error('❌ Error obteniendo total:', err);
            reject(err);
            return;
          }

          console.log(`\n📊 Total de eventos en DB: ${totalResult.total}`);
          
          // Confirmar la acción
          console.log(`\n⚠️  Se van a actualizar TODOS los eventos para usar la unidad: "${UNIT}"`);
          console.log('   - Se cambiará el campo "unit" en todos los registros');
          console.log('   - Se marcará syncStatus como "updated" para re-sincronizar');
          
          // Proceder con la actualización
          console.log('\n🔄 Procediendo con la actualización...');
          
          db.run(
            `UPDATE beacon_events 
             SET 
               unit = ?,
               syncStatus = CASE 
                 WHEN syncStatus = 'sent' THEN 'updated'
                 ELSE syncStatus 
               END`,
            [UNIT],
            function(err) {
              if (err) {
                console.error('❌ Error actualizando unidades:', err);
                reject(err);
                return;
              }

              console.log(`\n✅ Actualización completada!`);
              console.log(`   - Registros afectados: ${this.changes}`);
              console.log(`   - Nueva unidad: "${UNIT}"`);

              // Verificar el resultado
              db.all(
                `SELECT 
                  syncStatus,
                  COUNT(*) as cantidad
                 FROM beacon_events 
                 GROUP BY syncStatus`,
                (err, syncStats) => {
                  if (err) {
                    console.error('❌ Error verificando resultados:', err);
                    reject(err);
                    return;
                  }

                  console.log('\n📊 Estados de sincronización después de la actualización:');
                  syncStats.forEach(stat => {
                    console.log(`   ${stat.syncStatus}: ${stat.cantidad} eventos`);
                  });

                  console.log('\n🎯 Recomendaciones:');
                  console.log('   1. Los eventos marcados como "updated" se sincronizarán automáticamente');
                  console.log('   2. Los eventos "pending" se sincronizarán en la próxima sincronización');
                  console.log('   3. Verifica que el valor UNIT en tu .env sea correcto');
                  console.log('   4. Puedes verificar los cambios con: npm run view');

                  resolve({
                    totalUpdated: this.changes,
                    newUnit: UNIT,
                    syncStats: syncStats
                  });
                }
              );
            }
          );
        });
      }
    );
  });
}

// Función para verificar la configuración actual
function checkCurrentConfig() {
  return new Promise((resolve, reject) => {
    console.log('\n🔍 Verificando configuración actual...');
    
    db.all(
      `SELECT 
        unit,
        syncStatus,
        COUNT(*) as cantidad
       FROM beacon_events 
       GROUP BY unit, syncStatus
       ORDER BY unit, syncStatus`,
      (err, results) => {
        if (err) {
          console.error('❌ Error verificando configuración:', err);
          reject(err);
          return;
        }

        console.log('\n📋 Distribución actual por unidad y estado de sync:');
        if (results.length === 0) {
          console.log('   No hay eventos en la base de datos');
        } else {
          results.forEach(result => {
            console.log(`   Unidad: "${result.unit || 'NULL'}" | SyncStatus: "${result.syncStatus}" | Cantidad: ${result.cantidad}`);
          });
        }

        resolve(results);
      }
    );
  });
}

// Ejecutar el script
async function main() {
  try {
    console.log('🚀 Iniciando actualización masiva de unidades...\n');
    
    // Verificar configuración actual
    await checkCurrentConfig();
    
    // Actualizar todas las unidades
    const result = await updateAllUnits();
    
    console.log('\n✅ Proceso completado exitosamente!');
    console.log('🔄 La próxima sincronización enviará los cambios al servidor.');
    
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

// Ejecutar si se llama directamente
if (require.main === module) {
  main();
}

module.exports = { updateAllUnits, checkCurrentConfig };
