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
const ENV_FILE = path.join(__dirname, '../../.env');
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

// Conectar a la base de datos GPS (usa la misma beacons.db)
const dbGps = dbBeacons;
// --- API ENDPOINTS (GPS DATA) ---

// GET /api/gps/latest - Última posición GPS
app.get('/api/gps/latest', (req, res) => {
  dbGps.get('SELECT * FROM gps_data ORDER BY timestamp DESC LIMIT 1', (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Error consultando la base de datos GPS' });
    }
    if (!row) {
      return res.status(404).json({ error: 'No hay datos de GPS' });
    }
    res.json(row);
  });
});

// GET /api/gps/history - Historial de GPS (últimos 100)
app.get('/api/gps/history', (req, res) => {
  dbGps.all('SELECT * FROM gps_data ORDER BY timestamp DESC LIMIT 100', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Error consultando la base de datos GPS' });
    }
    res.json(rows);
  });
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

// Cache global para el estado de WiFi
let currentWifiStatusCache = { status: 'disconnected', ssid: '', bssid: '' };

app.get('/api/wifi/status', (req, res) => {
  // Retornar caché en lugar de bloquear el API con llamadas OS (`nmcli`, etc.)
  res.json(currentWifiStatusCache);
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

// GET /api/ble/recent - Obtener beacons detectados recientemente (PROMEDIO 30s)
app.get('/api/ble/recent', (req, res) => {
  // Busca eventos de los últimos 30 segundos
  const query = `
        SELECT beaconMac, distance, rssi, timestamp, eventState 
        FROM beacon_events 
        WHERE timestamp > datetime('now', '-30 seconds')
        ORDER BY timestamp DESC
    `;

  dbBeacons.all(query, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.json([]);
    }

    const beacons = {};

    rows.forEach(row => {
      if (!beacons[row.beaconMac]) {
        beacons[row.beaconMac] = {
          beaconMac: row.beaconMac,
          lastTimestamp: row.timestamp,
          lastState: row.eventState,
          rssiSum: 0,
          distSum: 0,
          count: 0
        };
      }
      const b = beacons[row.beaconMac];
      b.rssiSum += (parseInt(row.rssi) || 0);
      b.distSum += (parseFloat(row.distance) || 0);
      b.count++;
    });

    // Calcular promedios y formatear
    const results = Object.values(beacons).map(b => ({
      beaconMac: b.beaconMac,
      timestamp: b.lastTimestamp,
      eventState: b.lastState,
      rssi: Math.round(b.rssiSum / b.count),      // Promedio RSSI (entero)
      distance: (b.distSum / b.count).toFixed(2), // Promedio Distancia (2 decimales)
      samples: b.count                            // Cantidad de muestras usadas
    }));

    res.json(results);
  });
});

// Helper para calcular promedios desde JSON string
function calculateStatsFromHistory(rssiJson) {
  if (!rssiJson) return { avgRssi: 0, avgDistance: 0, count: 0, lastRssi: 0, lastDistance: 0 };

  try {
    const entries = JSON.parse(rssiJson);
    if (!entries || entries.length === 0) return { avgRssi: 0, avgDistance: 0, count: 0, lastRssi: 0, lastDistance: 0 };

    const sumRssi = entries.reduce((acc, curr) => acc + (curr.rssi || 0), 0);
    const sumDist = entries.reduce((acc, curr) => acc + (curr.distance || 0), 0);
    const count = entries.length;
    const lastEntry = entries[entries.length - 1];

    return {
      avgRssi: Math.round(sumRssi / count),
      avgDistance: Math.round(sumDist / count), // CM
      count: count,
      lastRssi: lastEntry.rssi,
      lastDistance: lastEntry.distance
    };
  } catch (e) {
    console.error("Error parsing RSSI JSON:", e);
    return { avgRssi: 0, avgDistance: 0, count: 0, lastRssi: 0, lastDistance: 0 };
  }
}

// GET /api/ble/history - Historial con promedios
app.get('/api/ble/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;

  const query = `
        SELECT id, beaconMac, rssi, timestamp, eventState, f_final 
        FROM beacon_events 
        ORDER BY timestamp DESC 
        LIMIT ? OFFSET ?
    `;

  dbBeacons.all(query, [limit, offset], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Error reading beacons db' });
    }

    // Procesar cada fila para calcular promedios
    const results = rows.map(row => {
      const stats = calculateStatsFromHistory(row.rssi);
      return {
        id: row.id,
        beaconMac: row.beaconMac,
        timestamp: row.f_final || row.timestamp, // Preferir f_final como "último visto"
        eventState: row.eventState,
        avgRssi: stats.avgRssi,
        avgDistance: stats.avgDistance, // CM
        samples: stats.count,
        lastRssi: stats.lastRssi,
        lastDistance: stats.lastDistance // CM
      };
    });

    res.json(results);
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

  // Actualizar caché para la interfaz web (evita llamadas pesadas por request)
  currentWifiStatusCache = status;

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
    res.sendFile(path.join(__dirname, '../../public', 'index.html'));
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
