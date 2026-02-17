// Script para probar limpieza de datos antiguos
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const logger = require('./logger');

const DB_FILE = process.env.DB_FILE || 'beacons.db';
const db = new sqlite3.Database(DB_FILE);

console.log('🧪 SCRIPT DE PRUEBA DE LIMPIEZA - BORRAR DATOS DE HOY\n');

// 1. Mostrar todos los GPS antes de limpieza
console.log('1️⃣ GPS actuales en BD ANTES de limpieza:');
db.all('SELECT id, unit, created, syncStatus, datetime(created/1000, "unixepoch") as fecha FROM gps_data ORDER BY id DESC LIMIT 20', (err, rows) => {
  if (err) {
    console.error('❌ Error:', err.message);
    db.close();
    return;
  }
  
  if (rows.length === 0) {
    console.log('⚠️ No hay datos GPS en la BD aún\n');
    db.close();
    return;
  }
  
  console.table(rows);
  console.log(`\nTotal GPS: ${rows.length} (mostrando últimos 20)\n`);
  
  // 2. Ejecutar limpieza de datos de HOY
  console.log('2️⃣ Ejecutando limpieza de TODOS los datos de hoy...\n');
  
  // Obtener inicio del día de hoy (00:00:00)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();
  
  console.log(`   Borrando GPS con created >= ${new Date(startOfToday).toISOString()}`);
  console.log(`   (Todos los datos desde hoy a las 00:00:00)\n`);
  
  db.run(`
    DELETE FROM gps_data 
    WHERE created >= ?
  `, [startOfToday], function(err) {
    if (err) {
      console.error('❌ Error limpiando:', err.message);
      db.close();
      return;
    }
    
    console.log(`✅ Limpieza completada: ${this.changes} registros GPS eliminados\n`);
    
    // 3. Limpiar beacons de hoy también
    db.run(`
      DELETE FROM beacon_events 
      WHERE created >= ?
    `, [startOfToday], function(err) {
      if (err) {
        console.error('❌ Error limpiando beacons:', err.message);
      } else if (this.changes > 0) {
        console.log(`✅ También eliminados: ${this.changes} beacons de hoy\n`);
      }
      
      // 4. Mostrar GPS después de limpieza
      console.log('3️⃣ GPS después de limpieza:');
      db.all('SELECT id, unit, created, syncStatus, datetime(created/1000, "unixepoch") as fecha FROM gps_data ORDER BY id DESC LIMIT 20', (err, rows) => {
        if (err) {
          console.error('❌ Error:', err.message);
        } else {
          if (rows.length === 0) {
            console.log('✅ Base de datos limpia - no hay GPS restantes\n');
          } else {
            console.table(rows);
            console.log(`\nGPS restantes: ${rows.length}\n`);
          }
        }
        
        console.log('✅ Prueba completada');
        db.close();
      });
    });
  });
});
