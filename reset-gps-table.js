// Script para resetear la tabla GPS y recrearla con las columnas correctas
const sqlite3 = require('sqlite3').verbose();
const DB_FILE = process.env.DB_FILE || 'beacons.db';

const db = new sqlite3.Database(DB_FILE);

console.log('🗑️  Eliminando tabla gps_data...');

db.serialize(() => {
  // Eliminar tabla GPS
  db.run('DROP TABLE IF EXISTS gps_data', (err) => {
    if (err) {
      console.error('❌ Error eliminando tabla:', err);
      process.exit(1);
    }
    console.log('✅ Tabla gps_data eliminada');

    // Recrear tabla GPS con todas las columnas
    db.run(`CREATE TABLE IF NOT EXISTS gps_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit TEXT,
      latitude REAL,
      longitude REAL,
      fix TEXT,
      timestamp TEXT,
      created TEXT,
      syncStatus TEXT DEFAULT 'pending',
      syncTimestamp TEXT,
      beaconMac TEXT,
      beaconUuid TEXT,
      beaconRssi INTEGER,
      beaconType TEXT,
      beaconDistance REAL,
      beaconName TEXT
    )`, (err) => {
      if (err) {
        console.error('❌ Error creando tabla:', err);
        process.exit(1);
      }
      console.log('✅ Tabla gps_data recreada con columnas de beacon');

      // Crear índices
      db.run('CREATE INDEX IF NOT EXISTS idx_gps_syncStatus ON gps_data(syncStatus)', () => {});
      db.run('CREATE INDEX IF NOT EXISTS idx_gps_created ON gps_data(created)', () => {});
      
      console.log('✅ Índices creados');
      console.log('🎉 Proceso completado. La tabla GPS está lista.');
      
      db.close();
      process.exit(0);
    });
  });
});
