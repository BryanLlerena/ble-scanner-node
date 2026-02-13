require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const wifiUtils = require('./wifi-utils');
const mqtt = require('mqtt');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.WIFI_PORT || 3035;
const DB_FILE = process.env.WIFI_DB_FILE || 'wifi_status.db';

// Configuración MQTT
const UNIT = process.env.UNIT || "TEST_UNIT";
const COMPANY = process.env.MQTT_COMPANY || 'gunjop';
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || null;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || null;
const MQTT_TOPIC = `${COMPANY}/unit/${UNIT.toLowerCase()}/wifi`;
const MQTT_CLIENT_ID = `wifi_${uuidv4()}_${UNIT}`;

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
  return await wifiUtils.getWifiStatus();
}

// Endpoint para borrar todos los registros de la tabla wifi_status
app.delete('/api/wifi/history', (req, res) => {
  db.run('DELETE FROM wifi_status', (err) => {
    if (err) {
      res.status(500).json({ error: 'Error al borrar la base de datos' });
    } else {
      res.json({ success: true });
    }
  });
});

app.get('/api/wifi/status', async (req, res) => {
  const status = await getWifiStatus();
  res.json(status);
});

// API con filtro de fechas opcional
app.get('/api/wifi/history', (req, res) => {
  let { from, to } = req.query;
  let query = 'SELECT * FROM wifi_status';
  const params = [];
  if (from && to) {
    query += ' WHERE timestamp BETWEEN ? AND ?';
    params.push(from, to);
  } else if (from) {
    query += ' WHERE timestamp >= ?';
    params.push(from);
  } else if (to) {
    query += ' WHERE timestamp <= ?';
    params.push(to);
  }
  query += ' ORDER BY timestamp DESC LIMIT 100';
  db.all(query, params, (err, rows) => {
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

// --- Lógica MQTT ---
let mqttClient = null;

function initMQTT() {
  const mqttOptions = {
    clientId: MQTT_CLIENT_ID,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
  };

  if (MQTT_USERNAME && MQTT_PASSWORD) {
    mqttOptions.username = MQTT_USERNAME;
    mqttOptions.password = MQTT_PASSWORD;
  }

  console.log(`📡 Conectando a MQTT broker: ${MQTT_BROKER}`);
  mqttClient = mqtt.connect(MQTT_BROKER, mqttOptions);

  mqttClient.on('connect', () => {
    console.log(`✅ [WiFi Service] Conectado a MQTT. Topic: ${MQTT_TOPIC}`);
  });

  mqttClient.on('error', (err) => {
    console.error('❌ [WiFi Service] Error MQTT:', err.message);
  });

  mqttClient.on('offline', () => {
    console.warn('⚠️ [WiFi Service] MQTT offline');
  });
}

// Inicializar MQTT
initMQTT();

// Bucle principal de monitoreo (DB + lógica de internet) - 10 segundos
setInterval(async () => {
  const status = await getWifiStatus();
  let online = false;

  if (status.status === 'connected') {
    online = await checkInternetConnection();
  }

  // Lógica de guardado en DB
  db.get('SELECT * FROM wifi_status ORDER BY timestamp DESC LIMIT 1', (err, row) => {
    let shouldSave = false;
    if (!row) {
      shouldSave = true;
    } else if (
      row.status !== status.status ||
      row.ssid !== status.ssid ||
      row.bssid !== status.bssid ||
      row.internet !== (online ? 1 : 0)
    ) {
      shouldSave = true;
    }

    if (shouldSave) {
      db.run(
        `INSERT INTO wifi_status (timestamp, ssid, bssid, status, internet) VALUES (?, ?, ?, ?, ?)`,
        [new Date().toISOString(), status.ssid, status.bssid, status.status, online ? 1 : 0]
      );
    }
  });

}, 10000);

// Bucle de envío MQTT - 60 segundos
setInterval(async () => {
  if (!mqttClient || !mqttClient.connected) return;

  const status = await getWifiStatus();

  const payload = {
    unit: UNIT,
    timestamp: new Date().toISOString(),
    ssid: status.ssid,
    bssid: status.bssid,
    status: status.status
  };

  mqttClient.publish(MQTT_TOPIC, JSON.stringify(payload), { qos: 0 }, (err) => {
    if (err) console.error('❌ Error enviando WiFi MQTT:', err);
    else console.log(`📡 Estado WiFi enviado a ${MQTT_TOPIC}`);
  });

}, 60000);


// Servir la vista web de historial WiFi
app.get('/wifi-history', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'wifi-history.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servicio WiFi iniciado en http://0.0.0.0:${PORT}`);
  console.log(`   Estado actual: http://0.0.0.0:${PORT}/api/wifi/status`);
});

process.on('SIGINT', () => {
  db.close();
  if (mqttClient) mqttClient.end();
  process.exit();
});
