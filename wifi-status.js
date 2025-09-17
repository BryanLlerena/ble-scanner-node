require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const wifi = require('node-wifi');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.WIFI_PORT || 3030;
const DB_FILE = process.env.WIFI_DB_FILE || 'wifi_status.db';

// Inicializar node-wifi
difi.init({ iface: null });

// Conectar a la base de datos
const db = new sqlite3.Database(DB_FILE);

db.run(`
  CREATE TABLE IF NOT EXISTS wifi_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    ssid TEXT,
    bssid TEXT,
    status TEXT,
    internet INTEGER
  )
`);



async function getWifiStatus() {
  return new Promise((resolve) => {
    wifi.getCurrentConnections((err, connections) => {
      if (err || !connections.length) {
        resolve({
          timestamp: new Date().toISOString(),
          ssid: null,
          bssid: null,
          status: 'disconnected'
        });
      } else {
        const { ssid, mac: bssid } = connections[0];
        resolve({
          timestamp: new Date().toISOString(),
          ssid,
          bssid,
          status: 'connected'
        });
      }
    });
  });
}



app.get('/api/wifi/status', async (req, res) => {
  const status = await getWifiStatus();
  res.json(status);
});

app.get('/api/wifi/history', (req, res) => {
  db.all(`SELECT * FROM wifi_status ORDER BY timestamp DESC LIMIT 100`, (err, rows) => {
    if (err) {
      res.status(500).json({ error: 'Error consultando la base de datos' });
    } else {
      res.json(rows);
    }
  });
});


// Verificar conexión a internet
const dns = require('dns');
function checkInternetConnection() {
  return new Promise((resolve) => {
    dns.lookup('google.com', (err) => {
      resolve(!err);
    });
  });
}


// Guardar estado cada 10 segundos solo si está conectado a WiFi, y guardar si hay o no internet
setInterval(async () => {
  const status = await getWifiStatus();
  if (status.status === 'connected') {
    const online = await checkInternetConnection();
    db.run(
      `INSERT INTO wifi_status (timestamp, ssid, bssid, status, internet) VALUES (?, ?, ?, ?, ?)`,
      [status.timestamp, status.ssid, status.bssid, status.status, online ? 1 : 0]
    );
  }
}, 10 * 1000);

app.listen(PORT, () => {
  console.log(`🌐 Servicio WiFi iniciado en http://localhost:${PORT}`);
  console.log(`   Estado actual: http://localhost:${PORT}/api/wifi/status`);
  console.log(`   Historial:     http://localhost:${PORT}/api/wifi/history`);
});

process.on('SIGINT', () => {
  db.close();
  process.exit();
});
