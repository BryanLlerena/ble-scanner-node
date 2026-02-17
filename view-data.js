// Script para ver datos almacenados en la base de datos
const sqlite3 = require('sqlite3').verbose();

// Conectar a la base de datos
const db = new sqlite3.Database('beacons.db', sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('❌ Error conectando a la base de datos:', err.message);
    process.exit(1);
  }
  console.log('📊 Conectado a la base de datos para consulta\n');
});

// Función para mostrar estadísticas generales
function showStats() {
  console.log('📈 ESTADÍSTICAS GENERALES:');
  console.log('=' .repeat(50));
  
  // Total de eventos beacon
  db.get(`SELECT COUNT(*) as total FROM beacon_events`, (err, row) => {
    if (err) console.error('Error:', err);
    else console.log(`📋 Total de eventos beacon: ${row.total}`);
  });
  
  // Total de registros GPS
  db.get(`SELECT COUNT(*) as total FROM gps_data`, (err, row) => {
    if (err && err.message.includes('no such table')) {
      console.log(`📍 Total de registros GPS: 0 (tabla no existe aún)`);
    } else if (err) {
      console.error('Error GPS:', err);
    } else {
      console.log(`📍 Total de registros GPS: ${row.total}`);
    }
  });
  
  // Estados de sincronización GPS
  db.all(`SELECT syncStatus, COUNT(*) as count FROM gps_data GROUP BY syncStatus`, (err, rows) => {
    if (err && !err.message.includes('no such table')) {
      console.error('Error:', err);
    } else if (rows && rows.length > 0) {
      rows.forEach(row => {
        console.log(`  🔹 GPS '${row.syncStatus}': ${row.count} registros`);
      });
    }
  });
  
  // Eventos abiertos vs cerrados
  db.all(`SELECT eventState, COUNT(*) as count FROM beacon_events GROUP BY eventState`, (err, rows) => {
    if (err) console.error('Error:', err);
    else {
      rows.forEach(row => {
        console.log(`🔹 Estado '${row.eventState}': ${row.count} eventos`);
      });
    }
  });
  
  // Beacons únicos
  db.get(`SELECT COUNT(DISTINCT beaconMac) as unique_beacons FROM beacon_events`, (err, row) => {
    if (err) console.error('Error:', err);
    else console.log(`📡 Beacons únicos detectados: ${row.unique_beacons}`);
  });
  
  // Rango de fechas
  db.get(`SELECT MIN(f_inicio) as first_event, MAX(f_final) as last_event FROM beacon_events`, (err, row) => {
    if (err) console.error('Error:', err);
    else {
      console.log(`📅 Primer evento: ${row.first_event || 'N/A'}`);
      console.log(`📅 Último evento: ${row.last_event || 'N/A'}`);
    }
  });
}

// Función para mostrar eventos detallados
function showDetailedEvents(limit = 10) {
  console.log(`\n📋 ÚLTIMOS ${limit} EVENTOS:`);
  console.log('=' .repeat(80));
  
  db.all(`
    SELECT 
      id,
      beaconMac,
      eventState,
      f_inicio,
      f_final,
      distanceInM,
      rssi,
      rssi_discard,
      unit
    FROM beacon_events 
    ORDER BY id DESC 
    LIMIT ?
  `, [limit], (err, rows) => {
    if (err) {
      console.error('Error:', err);
      return;
    }
    
    if (rows.length === 0) {
      console.log('📭 No hay eventos almacenados');
      return;
    }
    
    rows.forEach((row, index) => {
      console.log(`\n🔹 Evento ${row.id} (${row.eventState}):`);
      console.log(`   MAC: ${row.beaconMac}`);
      console.log(`   Unidad: ${row.unit}`);
      console.log(`   Inicio: ${row.f_inicio}`);
      console.log(`   Final: ${row.f_final || 'En curso'}`);
      console.log(`   Distancia: ${row.distanceInM}m`);
      
      // Mostrar conteo de RSSI
      try {
        const rssiArray = row.rssi ? JSON.parse(row.rssi) : [];
        const rssiDiscardArray = row.rssi_discard ? JSON.parse(row.rssi_discard) : [];
        console.log(`   RSSI válidos: ${rssiArray.length} lecturas`);
        console.log(`   RSSI descartados: ${rssiDiscardArray.length} lecturas`);
      } catch (parseErr) {
        console.log(`   RSSI: Error parseando datos`);
      }
    });
  });
}

// Función para mostrar eventos por beacon específico
function showBeaconEvents(mac) {
  console.log(`\n📡 EVENTOS PARA BEACON: ${mac}`);
  console.log('=' .repeat(60));
  
  db.all(`
    SELECT 
      id,
      eventState,
      f_inicio,
      f_final,
      distanceInM,
      rssi,
      rssi_discard
    FROM beacon_events 
    WHERE beaconMac = ?
    ORDER BY id DESC
  `, [mac], (err, rows) => {
    if (err) {
      console.error('Error:', err);
      return;
    }
    
    if (rows.length === 0) {
      console.log(`📭 No se encontraron eventos para el beacon ${mac}`);
      return;
    }
    
    rows.forEach(row => {
      console.log(`\n🔹 Evento ${row.id} (${row.eventState}):`);
      console.log(`   Inicio: ${row.f_inicio}`);
      console.log(`   Final: ${row.f_final || 'En curso'}`);
      console.log(`   Distancia: ${row.distanceInM}m`);
      
      try {
        const rssiArray = row.rssi ? JSON.parse(row.rssi) : [];
        const rssiDiscardArray = row.rssi_discard ? JSON.parse(row.rssi_discard) : [];
        console.log(`   RSSI válidos: ${rssiArray.length} lecturas`);
        console.log(`   RSSI descartados: ${rssiDiscardArray.length} lecturas`);
        
        // Mostrar algunas lecturas RSSI si hay
        if (rssiArray.length > 0) {
          console.log(`   Primera lectura RSSI: ${rssiArray[0].rssi} (${new Date(rssiArray[0].datetime).toLocaleString()})`);
          if (rssiArray.length > 1) {
            const last = rssiArray[rssiArray.length - 1];
            console.log(`   Última lectura RSSI: ${last.rssi} (${new Date(last.datetime).toLocaleString()})`);
          }
        }
      } catch (parseErr) {
        console.log(`   RSSI: Error parseando datos`);
      }
    });
  });
}

// Función para mostrar datos GPS
function showGPSData(limit = 10) {
  console.log(`\n📍 ÚLTIMOS ${limit} REGISTROS GPS:`);
  console.log('=' .repeat(80));
  
  db.all(`
    SELECT 
      id,
      unit,
      latitude,
      longitude,
      fix,
      timestamp,
      created,
      syncStatus,
      syncTimestamp
    FROM gps_data 
    ORDER BY id DESC 
    LIMIT ?
  `, [limit], (err, rows) => {
    if (err) {
      if (err.message.includes('no such table')) {
        console.log('📭 Tabla GPS aún no existe. Se creará cuando ejecutes index.js');
      } else {
        console.error('Error:', err);
      }
      return;
    }
    
    if (rows.length === 0) {
      console.log('📭 No hay registros GPS almacenados');
      return;
    }
    
    rows.forEach(row => {
      console.log(`\n🔹 GPS #${row.id} (${row.syncStatus}):`);
      console.log(`   Unidad: ${row.unit}`);
      console.log(`   Latitud: ${row.latitude}`);
      console.log(`   Longitud: ${row.longitude}`);
      console.log(`   Fix: ${row.fix}`);
      console.log(`   Timestamp: ${row.timestamp}`);
      console.log(`   Creado: ${row.created}`);
      if (row.syncTimestamp) {
        console.log(`   Sincronizado: ${row.syncTimestamp}`);
      }
    });
  });
}

// Procesar argumentos de línea de comandos
const args = process.argv.slice(2);

if (args.length === 0) {
  // Sin argumentos: mostrar estadísticas y últimos eventos
  showStats();
  setTimeout(() => {
    showDetailedEvents(5);
    setTimeout(() => {
      db.close();
      console.log('\n✅ Consulta completada');
    }, 500);
  }, 500);
} else if (args[0] === '--all') {
  // Mostrar todos los eventos
  const limit = args[1] ? parseInt(args[1]) : 50;
  showDetailedEvents(limit);
  setTimeout(() => {
    db.close();
    console.log('\n✅ Consulta completada');
  }, 500);
} else if (args[0] === '--beacon') {
  // Mostrar eventos de un beacon específico
  if (args[1]) {
    showBeaconEvents(args[1]);
    setTimeout(() => {
      db.close();
      console.log('\n✅ Consulta completada');
    }, 500);
  } else {
    console.log('❌ Uso: node view-data.js --beacon <MAC_ADDRESS>');
    db.close();
  }
} else if (args[0] === '--stats') {
  // Solo estadísticas
  showStats();
  setTimeout(() => {
    db.close();
    console.log('\n✅ Consulta completada');
  }, 500);
} else if (args[0] === '--gps') {
  // Mostrar datos GPS
  const limit = args[1] ? parseInt(args[1]) : 20;
  showGPSData(limit);
  setTimeout(() => {
    db.close();
    console.log('\n✅ Consulta completada');
  }, 500);
} else {
  console.log('📊 Uso del script:');
  console.log('  node view-data.js                    # Estadísticas + últimos 5 eventos');
  console.log('  node view-data.js --all [limite]     # Mostrar eventos (por defecto 50)');
  console.log('  node view-data.js --beacon <MAC>     # Eventos de un beacon específico');
  console.log('  node view-data.js --gps [limite]     # Mostrar datos GPS (por defecto 20)');
  console.log('  node view-data.js --stats            # Solo estadísticas');
  db.close();
}
