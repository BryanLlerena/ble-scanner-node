// Script para borrar datos de la base de datos
const sqlite3 = require('sqlite3').verbose();
const readline = require('readline');

// Interfaz para input del usuario
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Conectar a la base de datos
const db = new sqlite3.Database('beacons.db', (err) => {
  if (err) {
    console.error('❌ Error conectando a la base de datos:', err.message);
    process.exit(1);
  }
  console.log('🗑️  Conectado a la base de datos para limpieza\n');
});

// Función para confirmar acción
function askConfirmation(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'sí' || answer.toLowerCase() === 's');
    });
  });
}

// Función para mostrar estadísticas antes de borrar
function showCurrentStats() {
  return new Promise((resolve) => {
    console.log('📊 ESTADÍSTICAS ACTUALES:');
    console.log('=' .repeat(40));
    
    db.get(`SELECT COUNT(*) as total FROM beacon_events`, (err, row) => {
      if (err) {
        console.error('Error:', err);
        resolve();
        return;
      }
      
      console.log(`📋 Total de eventos: ${row.total}`);
      
      if (row.total === 0) {
        console.log('📭 La base de datos ya está vacía');
        resolve();
        return;
      }
      
      // Mostrar eventos por estado
      db.all(`SELECT eventState, COUNT(*) as count FROM beacon_events GROUP BY eventState`, (err, rows) => {
        if (err) console.error('Error:', err);
        else {
          rows.forEach(row => {
            console.log(`🔹 Estado '${row.eventState}': ${row.count} eventos`);
          });
        }
        
        // Mostrar beacons únicos
        db.get(`SELECT COUNT(DISTINCT beaconMac) as unique_beacons FROM beacon_events`, (err, row) => {
          if (err) console.error('Error:', err);
          else console.log(`📡 Beacons únicos: ${row.unique_beacons}`);
          
          console.log(''); // Línea en blanco
          resolve();
        });
      });
    });
  });
}

// Función para borrar todos los datos
async function deleteAllData() {
  await showCurrentStats();
  
  const confirm = await askConfirmation('⚠️  ¿Estás seguro de que quieres BORRAR TODOS los datos? (y/n): ');
  
  if (!confirm) {
    console.log('❌ Operación cancelada');
    rl.close();
    db.close();
    return;
  }
  
  const doubleConfirm = await askConfirmation('🚨 ÚLTIMA CONFIRMACIÓN: Esto borrará TODOS los eventos permanentemente. ¿Continuar? (y/n): ');
  
  if (!doubleConfirm) {
    console.log('❌ Operación cancelada');
    rl.close();
    db.close();
    return;
  }
  
  console.log('🗑️  Borrando todos los datos...');
  
  db.run(`DELETE FROM beacon_events`, (err) => {
    if (err) {
      console.error('❌ Error borrando datos:', err);
    } else {
      console.log('✅ Todos los datos han sido borrados exitosamente');
      
      // Verificar que se borraron
      db.get(`SELECT COUNT(*) as total FROM beacon_events`, (err, row) => {
        if (err) console.error('Error verificando:', err);
        else console.log(`📊 Eventos restantes: ${row.total}`);
        
        rl.close();
        db.close();
      });
    }
  });
}

// Función para borrar eventos específicos
async function deleteByCondition(condition, params, description) {
  await showCurrentStats();
  
  console.log(`🎯 Filtrando eventos: ${description}`);
  
  // Mostrar qué se va a borrar
  db.all(`SELECT COUNT(*) as count FROM beacon_events WHERE ${condition}`, params, async (err, rows) => {
    if (err) {
      console.error('❌ Error consultando datos:', err);
      rl.close();
      db.close();
      return;
    }
    
    const count = rows[0].count;
    
    if (count === 0) {
      console.log('📭 No se encontraron eventos que coincidan con el criterio');
      rl.close();
      db.close();
      return;
    }
    
    console.log(`🗑️  Se borrarán ${count} eventos`);
    
    const confirm = await askConfirmation(`⚠️  ¿Confirmas borrar ${count} eventos? (y/n): `);
    
    if (!confirm) {
      console.log('❌ Operación cancelada');
      rl.close();
      db.close();
      return;
    }
    
    db.run(`DELETE FROM beacon_events WHERE ${condition}`, params, (err) => {
      if (err) {
        console.error('❌ Error borrando eventos:', err);
      } else {
        console.log(`✅ ${count} eventos borrados exitosamente`);
      }
      
      rl.close();
      db.close();
    });
  });
}

// Procesar argumentos de línea de comandos
const args = process.argv.slice(2);

async function main() {
  if (args.length === 0) {
    // Sin argumentos: borrar todo
    await deleteAllData();
  } else if (args[0] === '--closed') {
    // Borrar solo eventos cerrados
    await deleteByCondition('eventState = ?', ['closed'], 'eventos cerrados');
  } else if (args[0] === '--open') {
    // Borrar solo eventos abiertos
    await deleteByCondition('eventState = ?', ['open'], 'eventos abiertos');
  } else if (args[0] === '--beacon' && args[1]) {
    // Borrar eventos de un beacon específico
    await deleteByCondition('beaconMac = ?', [args[1]], `eventos del beacon ${args[1]}`);
  } else if (args[0] === '--older-than' && args[1]) {
    // Borrar eventos más antiguos que X días
    const days = parseInt(args[1]);
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    await deleteByCondition('f_inicio < ?', [cutoffDate], `eventos más antiguos que ${days} días`);
  } else if (args[0] === '--unit' && args[1]) {
    // Borrar eventos de una unidad específica
    await deleteByCondition('unit = ?', [args[1]], `eventos de la unidad ${args[1]}`);
  } else {
    console.log('🗑️  Uso del script:');
    console.log('  node delete-data.js                        # Borrar TODOS los datos');
    console.log('  node delete-data.js --closed               # Borrar solo eventos cerrados');
    console.log('  node delete-data.js --open                 # Borrar solo eventos abiertos');
    console.log('  node delete-data.js --beacon <MAC>         # Borrar eventos de un beacon');
    console.log('  node delete-data.js --older-than <días>    # Borrar eventos más antiguos que X días');
    console.log('  node delete-data.js --unit <código>        # Borrar eventos de una unidad');
    rl.close();
    db.close();
  }
}

main().catch(err => {
  console.error('❌ Error:', err);
  rl.close();
  db.close();
});
