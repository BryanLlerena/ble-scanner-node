// gps-status.js
// Microservicio para exponer el estado y el historial del GPS

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.GPS_PORT || 3050;
const DB_FILE = process.env.GPS_DB_FILE || path.join(__dirname, 'beacons.db');

// Conexión a la base de datos
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Error abriendo la base de datos GPS:', err.message);
  } else {
    console.log('Conectado a la base de datos GPS:', DB_FILE);
  }
});

// Endpoint para obtener el último dato de GPS
app.get('/api/gps/latest', (req, res) => {
  db.get('SELECT * FROM gps_data ORDER BY timestamp DESC LIMIT 1', (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Error consultando la base de datos GPS' });
    }
    if (!row) {
      return res.status(404).json({ error: 'No hay datos de GPS' });
    }
    res.json(row);
  });
});

// Endpoint para historial de GPS (últimos 100)
app.get('/api/gps/history', (req, res) => {
  db.all('SELECT * FROM gps_data ORDER BY timestamp DESC LIMIT 100', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Error consultando la base de datos GPS' });
    }
    res.json(rows);
  });
});

// Servir index.html si se desea (opcional)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Endpoint not found' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚗 Servicio GPS iniciado en http://0.0.0.0:${PORT}`);
});

process.on('SIGINT', () => {
  db.close();
  process.exit();
});
