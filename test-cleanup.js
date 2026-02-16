// Script para probar limpieza de datos antiguos
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const logger = require('./logger');

const DB_FILE = process.env.DB_FILE || 'beacons.db';
const db = new sqlite3.Database(DB_FILE);

console.log('🧪 SCRIPT DE PRUEBA DE LIMPIEZA (MODO TESTING - 30 MIN)\n');

// 1. Insertar datos de prueba GPS antiguos (35 minutos atrás)
const thirtyFiveMinutesAgo = Date.now() - (35 * 60 * 1000);

console.log('1️⃣ Insertando GPS de prueba (35 minutos atrás, syncStatus=pending)...');
console.log('   (Simula GPS antiguo para probar limpieza inmediata)\n');
db.run(`
  INSERT INTO gps_data (unit, latitude, longitude, fix, timestamp, created, syncStatus)
  VALUES ('TEST_UNIT', -12.0464, -77.0428, '1', datetime('now'), ?, 'pending')
`, [thirtyFiveMinutesAgo], function(err) {
  if (err) {
    console.error('❌ Error insertando GPS prueba:', err.message);
  } else {
    console.log(`✅ GPS de prueba insertado con ID ${this.lastID}\n`);
    
    // 2. Mostrar todos los GPS
    console.log('2️⃣ GPS actuales en BD:');
    db.all('SELECT id, unit, created, syncStatus, datetime(created/1000, "unixepoch") as fecha FROM gps_data', (err, rows) => {
      if (err) {
        console.error('❌ Error:', err.message);
      } else {
        console.table(rows);
        
        // 3. Ejecutar limpieza
        console.log('\n3️⃣ Ejecutando limpieza (datos > 30 minutos, cualquier syncStatus)...');
        console.log('   (MODO TESTING: borra datos > 30 min para prueba rápida)\n');
        const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
        
        db.run(`
          DELETE FROM gps_data 
          WHERE created < ?
        `, [thirtyMinutesAgo], function(err) {
          if (err) {
            console.error('❌ Error limpiando:', err.message);
          } else {
            console.log(`\n✅ Limpieza completada: ${this.changes} registros eliminados\n`);
            
            // 4. Mostrar GPS después de limpieza
            console.log('4️⃣ GPS después de limpieza:');
            db.all('SELECT id, unit, created, syncStatus FROM gps_data', (err, rows) => {
              if (err) {
                console.error('❌ Error:', err.message);
              } else {
                console.table(rows);
                
                console.log('\n✅ Prueba completada');
                db.close();
              }
            });
          }
        });
      }
    });
  }
});
