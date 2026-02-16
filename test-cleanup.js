// Script para probar limpieza de datos antiguos
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const logger = require('./logger');

const DB_FILE = process.env.DB_FILE || 'beacons.db';
const db = new sqlite3.Database(DB_FILE);

console.log('🧪 SCRIPT DE PRUEBA DE LIMPIEZA\n');

// 1. Insertar datos de prueba GPS antiguos (8 días atrás)
const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);

console.log('1️⃣ Insertando GPS de prueba (8 días atrás, syncStatus=pending)...');
console.log('   (Simula GPS que nunca se pudo sincronizar por falta de endpoint)\n');
db.run(`
  INSERT INTO gps_data (unit, latitude, longitude, fix, timestamp, created, syncStatus)
  VALUES ('TEST_UNIT', -12.0464, -77.0428, '1', datetime('now'), ?, 'pending')
`, [eightDaysAgo], function(err) {
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
        console.log('\n3️⃣ Ejecutando limpieza (datos > 7 días, cualquier syncStatus)...');
        console.log('   (Para testing borramos pending también, en producción solo sent)\n');
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        
        db.run(`
          DELETE FROM gps_data 
          WHERE created < ?
        `, [sevenDaysAgo], function(err) {
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
