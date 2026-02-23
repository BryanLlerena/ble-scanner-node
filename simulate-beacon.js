// Simula la inserción continua de un beacon en la base de datos beacons.db
// Ejecuta este script con: node simulate-beacon.js o pm2 start simulate-beacon.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_FILE = path.join(__dirname, 'beacons.db');

function insertSimulatedBeacon() {
    const db = new sqlite3.Database(DB_FILE);
    const beaconMac = 'FA:KE:BE:AC:01:23'; // MAC de prueba
    const deviceId = 'SIMULATED_DEVICE';
    const rssi = -60;
    const distance = 1.5; // metros
    const eventState = 'active';
    const timestamp = new Date().toISOString();
    const uuid = 'simulated-uuid';
    const query = `
        INSERT INTO beacon_events (deviceId, beaconMac, rssi, distance, timestamp, eventState, uuid)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(query, [deviceId, beaconMac, rssi, distance, timestamp, eventState, uuid], function(err) {
        if (err) {
            console.error('Error insertando beacon simulado:', err.message);
        } else {
            console.log('Beacon simulado insertado:', { id: this.lastID, beaconMac, timestamp });
        }
        db.close();
    });
}

setInterval(insertSimulatedBeacon, 1000); // Cada segundo
console.log('Simulación de beacon iniciada. Insertando un beacon cada segundo...');
