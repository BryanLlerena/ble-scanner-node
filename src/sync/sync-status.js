// Script para ver estado de sincronización
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../../beacons.db');
const db = new sqlite3.Database(dbPath);

function showSyncStatus() {
  console.log('\n📊 ESTADO DE SINCRONIZACIÓN');
  console.log('============================');
  
  db.all(`
    SELECT 
      syncStatus,
      eventState,
      COUNT(*) as count
    FROM beacon_events 
    GROUP BY syncStatus, eventState
    ORDER BY syncStatus, eventState
  `, (err, rows) => {
    if (err) {
      console.error('Error:', err);
      return;
    }
    
    rows.forEach(row => {
      console.log(`${row.eventState} - ${row.syncStatus || 'NULL'}: ${row.count} eventos`);
    });
    
    console.log('\n📋 EVENTOS PENDIENTES DE SINCRONIZACIÓN');
    console.log('=======================================');
    
    db.all(`
      SELECT 
        id, beaconMac, eventState, syncStatus, 
        f_inicio, f_final,
        datetime(timestamp) as timestamp
      FROM beacon_events 
      WHERE eventState = 'closed' AND (syncStatus IS NULL OR syncStatus IN ('pending', 'updated'))
      ORDER BY timestamp DESC
      LIMIT 10
    `, (err, pendingRows) => {
      if (err) {
        console.error('Error:', err);
        return;
      }
      
      if (pendingRows.length === 0) {
        console.log('✅ No hay eventos pendientes de sincronización');
      } else {
        console.log(`📤 ${pendingRows.length} eventos pendientes:\n`);
        pendingRows.forEach(event => {
          console.log(`ID: ${event.id} | MAC: ${event.beaconMac} | Estado: ${event.eventState} | Sync: ${event.syncStatus || 'pending'}`);
          console.log(`   Inicio: ${event.f_inicio} | Final: ${event.f_final || 'N/A'}`);
          console.log('');
        });
      }
      
      console.log('\n📈 ÚLTIMOS EVENTOS ENVIADOS');
      console.log('===========================');
      
      db.all(`
        SELECT 
          id, beaconMac, eventState, syncStatus,
          datetime(syncTimestamp) as syncTimestamp,
          datetime(timestamp) as timestamp
        FROM beacon_events 
        WHERE syncStatus = 'sent'
        ORDER BY syncTimestamp DESC
        LIMIT 5
      `, (err, sentRows) => {
        if (err) {
          console.error('Error:', err);
          return;
        }
        
        if (sentRows.length === 0) {
          console.log('📭 No hay eventos enviados aún');
        } else {
          sentRows.forEach(event => {
            console.log(`ID: ${event.id} | MAC: ${event.beaconMac} | Enviado: ${event.syncTimestamp}`);
          });
        }
        
        console.log('\n✅ Consulta completada');
        db.close();
      });
    });
  });
}

function resetSyncStatus() {
  console.log('\n🔄 REINICIANDO ESTADO DE SINCRONIZACIÓN...');
  
  db.run(`
    UPDATE beacon_events 
    SET syncStatus = 'pending', syncTimestamp = NULL 
    WHERE eventState = 'closed'
  `, function(err) {
    if (err) {
      console.error('Error:', err);
      return;
    }
    
    console.log(`✅ ${this.changes} eventos marcados como pendientes`);
    console.log('Todos los eventos cerrados serán enviados en la próxima sincronización');
    db.close();
  });
}

// Manejar argumentos de línea de comandos
const args = process.argv.slice(2);

if (args.includes('--reset')) {
  resetSyncStatus();
} else {
  showSyncStatus();
}
