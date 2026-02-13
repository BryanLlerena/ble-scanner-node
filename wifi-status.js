const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const wifiUtils = require('./wifi-utils');
const mqtt = require('mqtt');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Servir archivos estáticos desde 'public'

const PORT = process.env.WIFI_PORT || 3035;
const DB_FILE = process.env.WIFI_DB_FILE || 'wifi_status.db';
const ENV_FILE = path.join(__dirname, '.env');
const BEACONS_DB_FILE = process.env.DB_FILE || 'beacons.db';

// Configuración MQTT
const UNIT = process.env.UNIT || "TEST_UNIT";
const COMPANY = process.env.MQTT_COMPANY || 'gunjop';
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || null;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || null;
const MQTT_TOPIC = `${COMPANY}/unit/${UNIT.toLowerCase()}/wifi`;
const MQTT_CLIENT_ID = `wifi_${uuidv4()}_${UNIT}`;

// Conectar a la base de datos WiFi
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

// Conectar a la base de datos Beacons (SCANNER)
const dbBeacons = new sqlite3.Database(BEACONS_DB_FILE, sqlite3.OPEN_READONLY, (err) => {
  if (err) console.error('Error al conectar con beacons.db:', err.message);
  else console.log('✅ Conectado a beacons.db para lectura');
});

// --- FUNCIONES AUXILIARES (.ENV) ---
function parseEnv(content) {
  const env = [];
  let currentComment = '';

  content.split(/\r?\n/).forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('#')) {
      currentComment = trimmedLine.substring(1).trim();
    } else {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        env.push({
          key,
          value: value.replace(/^["'](.*)["']$/, '$1'),
          description: currentComment
        });
        currentComment = '';
      }
    }
  });
  return env;
}

// --- API ENDPOINTS (CONFIG SERVER MERGED) ---

// GET /api/env - Leer archivo .env
app.get('/api/env', (req, res) => {
  fs.readFile(ENV_FILE, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.json({});
      }
      return res.status(500).json({ error: 'Failed to read .env file' });
    }
    const envVars = parseEnv(data);
    res.json(envVars);
  });
});

// POST /api/env - Escribir archivo .env
app.post('/api/env', (req, res) => {
  const changes = req.body;

  fs.readFile(ENV_FILE, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read .env file for updating' });
    }

    let newContent = data;
    const items = Array.isArray(changes)
      ? changes
      : Object.entries(changes).map(([key, value]) => ({ key, value }));

    items.forEach(item => {
      const regex = new RegExp(`^(${item.key})=(.*)$`, 'm');
      if (regex.test(newContent)) {
        newContent = newContent.replace(regex, `$1=${item.value}`);
      } else {
        const prefix = newContent.endsWith('\n') ? '' : '\n';
        newContent += `${prefix}${item.key}=${item.value}\n`;
      }
    });

    fs.writeFile(ENV_FILE, newContent, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to save .env file' });
      }
      res.json({ success: true, message: 'Configuration saved' });
    });
  });
});

// POST /api/restart - Reiniciar procesos PM2
app.post('/api/restart', (req, res) => {
  console.log('Restarting processes via PM2...');
  exec('pm2 restart ecosystem.config.js', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).json({ error: 'Failed to restart processes', details: stderr });
    }
    console.log(`stdout: ${stdout}`);
    res.json({ success: true, message: 'Processes restarting...' });
  });
});

// --- API ENDPOINTS (WIFI STATUS) ---

async function getWifiStatus() {
  return await wifiUtils.getWifiStatus();
}

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

// --- API ENDPOINTS (BLE DATA) ---

// GET /api/ble/recent - Obtener beacons detectados recientemente (útil para "Live View")
app.get('/api/ble/recent', (req, res) => {
  // Retorna los últimos 50 eventos ordenados por fecha descendente
  // Esto da una idea de qué está "vivo" ahora mismo.
  const query = `
        SELECT beaconMac, distance, rssi, timestamp, eventState 
        FROM beacon_events 
        ORDER BY timestamp DESC 
        LIMIT 50
    `;

  dbBeacons.all(query, [], (err, rows) => {
    if (err) {
      // Si la tabla no existe aún (app recién iniciada), retorna array vacío
      return res.json([]);
    }

    // Agrupar por MAC para mostrar solo el último estado de cada uno.
    // Pero devolver lista plana.
    const uniqueBeacons = {};
    rows.forEach(row => {
      if (!uniqueBeacons[row.beaconMac]) {
        uniqueBeacons[row.beaconMac] = row;
      }
    });

    res.json(Object.values(uniqueBeacons));
  });
});

// GET /api/ble/history - Historial completo de beacons
app.get('/api/ble/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;

  const query = `
        SELECT * FROM beacon_events 
        ORDER BY timestamp DESC 
        LIMIT ? OFFSET ?
    `;

  dbBeacons.all(query, [limit, offset], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Error reading beacons db' });
    }
    res.json(rows);
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
    // else console.log(`📡 Estado WiFi enviado a ${MQTT_TOPIC}`);
  });

}, 60000);

// Servir index.html (SPA) para cualquier ruta no-API
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Endpoint not found' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Dashboard Unificado iniciado en http://0.0.0.0:${PORT}`);
});

process.on('SIGINT', () => {
  db.close();
  if (mqttClient) mqttClient.end();
  process.exit();
});
