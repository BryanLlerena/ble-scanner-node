// Servidor web para visualizar datos de beacons
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const cors = require('cors');

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const DB_FILE = process.env.DB_FILE || "beacons.db";

// Middleware
app.use(cors());
app.use(express.json());

app.use(express.static('public'));

// --- API GPS DIRECTAMENTE AQUÍ ---
// GET /api/gps/latest - Última posición GPS
app.get('/api/gps/latest', (req, res) => {
  db.get(
    `SELECT * FROM gps_data ORDER BY timestamp DESC LIMIT 1`,
    [],
    (err, row) => {
      if (err) {
        console.error('Error consultando GPS:', err);
        res.status(500).json({ error: 'Error consultando la base de datos' });
        return;
      }
      if (!row) {
        res.status(404).json({ error: 'No hay datos GPS' });
        return;
      }
      res.json(row);
    }
  );
});

// GET /api/gps/history - Últimos N puntos GPS
app.get('/api/gps/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  db.all(
    `SELECT * FROM gps_data ORDER BY timestamp DESC LIMIT ?`,
    [limit],
    (err, rows) => {
      if (err) {
        console.error('Error consultando historial GPS:', err);
        res.status(500).json({ error: 'Error consultando la base de datos' });
        return;
      }
      res.json(rows);
    }
  );
});

// Conectar a la base de datos
const db = new sqlite3.Database(DB_FILE);
db.configure('busyTimeout', 10000);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000; PRAGMA synchronous = NORMAL;');

// Ruta principal - servir el HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public', 'index.html'));
});

// API para obtener todos los eventos con filtros
app.get('/api/events', (req, res) => {
  const {
    unit,
    beaconMac,
    eventState,
    syncStatus,
    startDate,
    endDate,
    limit = 100,
    offset = 0
  } = req.query;

  let query = `
    SELECT 
      id,
      deviceId,
      beaconMac,
      name,
      rssi,
      rssi_discard,
      timestamp,
      type,
      uuid,
      major,
      minor,
      txPower,
      namespace,
      instance,
      distance,
      distanceInM,
      eventState,
      f_inicio,
      f_final,
      unit,
      manufacturerData,
      serviceData,
      syncStatus,
      syncTimestamp
    FROM beacon_events
    WHERE 1=1
  `;

  const params = [];

  // Aplicar filtros
  if (unit) {
    query += ` AND unit = ?`;
    params.push(unit);
  }

  if (beaconMac) {
    query += ` AND beaconMac LIKE ?`;
    params.push(`%${beaconMac}%`);
  }

  if (eventState) {
    query += ` AND eventState = ?`;
    params.push(eventState);
  }

  if (syncStatus) {
    query += ` AND syncStatus = ?`;
    params.push(syncStatus);
  }

  if (startDate) {
    query += ` AND f_inicio >= ?`;
    params.push(startDate);
  }

  if (endDate) {
    query += ` AND f_final <= ?`;
    params.push(endDate);
  }

  query += ` ORDER BY f_inicio DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error consultando eventos:', err);
      res.status(500).json({ error: 'Error consultando la base de datos' });
      return;
    }

    // Procesar datos RSSI para mostrar conteos
    const processedRows = rows.map(row => {
      let rssiCount = 0;
      let rssiDiscardCount = 0;

      try {
        if (row.rssi) {
          const rssiArray = JSON.parse(row.rssi);
          rssiCount = Array.isArray(rssiArray) ? rssiArray.length : 0;
        }
        if (row.rssi_discard) {
          const rssiDiscardArray = JSON.parse(row.rssi_discard);
          rssiDiscardCount = Array.isArray(rssiDiscardArray) ? rssiDiscardArray.length : 0;
        }
      } catch (parseErr) {
        console.error('Error parseando RSSI:', parseErr);
      }

      return {
        ...row,
        rssiCount,
        rssiDiscardCount,
        duration: row.f_final && row.f_inicio ?
          Math.round((new Date(row.f_final) - new Date(row.f_inicio)) / 1000) : 0
      };
    });

    res.json(processedRows);
  });
});

// API para obtener estadísticas generales
app.get('/api/stats', (req, res) => {
  const queries = {
    totalEvents: `SELECT COUNT(*) as count FROM beacon_events`,
    openEvents: `SELECT COUNT(*) as count FROM beacon_events WHERE eventState = 'open'`,
    closedEvents: `SELECT COUNT(*) as count FROM beacon_events WHERE eventState = 'closed'`,
    pendingSync: `SELECT COUNT(*) as count FROM beacon_events WHERE syncStatus = 'pending'`,
    sentSync: `SELECT COUNT(*) as count FROM beacon_events WHERE syncStatus = 'sent'`,
    updatedSync: `SELECT COUNT(*) as count FROM beacon_events WHERE syncStatus = 'updated'`,
    uniqueBeacons: `SELECT COUNT(DISTINCT beaconMac) as count FROM beacon_events`,
    units: `SELECT DISTINCT unit FROM beacon_events WHERE unit IS NOT NULL`
  };

  const stats = {};
  let completedQueries = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    if (key === 'units') {
      db.all(query, (err, rows) => {
        if (err) {
          console.error(`Error en consulta ${key}:`, err);
          stats[key] = [];
        } else {
          stats[key] = rows.map(row => row.unit);
        }
        completedQueries++;
        if (completedQueries === totalQueries) {
          res.json(stats);
        }
      });
    } else {
      db.get(query, (err, row) => {
        if (err) {
          console.error(`Error en consulta ${key}:`, err);
          stats[key] = 0;
        } else {
          stats[key] = row.count;
        }
        completedQueries++;
        if (completedQueries === totalQueries) {
          res.json(stats);
        }
      });
    }
  });
});

// API para obtener detalles de un evento específico
app.get('/api/events/:id', (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT * FROM beacon_events WHERE id = ?`,
    [id],
    (err, row) => {
      if (err) {
        console.error('Error consultando evento:', err);
        res.status(500).json({ error: 'Error consultando la base de datos' });
        return;
      }

      if (!row) {
        res.status(404).json({ error: 'Evento no encontrado' });
        return;
      }

      // Procesar arrays RSSI
      let rssiArray = [];
      let rssiDiscardArray = [];

      try {
        if (row.rssi) {
          rssiArray = JSON.parse(row.rssi);
        }
        if (row.rssi_discard) {
          rssiDiscardArray = JSON.parse(row.rssi_discard);
        }
      } catch (parseErr) {
        console.error('Error parseando RSSI:', parseErr);
      }

      const eventDetails = {
        ...row,
        rssiArray,
        rssiDiscardArray,
        duration: row.f_final && row.f_inicio ?
          Math.round((new Date(row.f_final) - new Date(row.f_inicio)) / 1000) : 0
      };

      res.json(eventDetails);
    }
  );
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor web iniciado en http://0.0.0.0:${PORT}`);
  console.log(`   Acceso local: http://localhost:${PORT}`);
  console.log(`   Acceso por IP: http://[TU_IP]:${PORT}`);
});

// Manejar cierre del servidor
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidor web...');
  db.close((err) => {
    if (err) {
      console.error('❌ Error cerrando base de datos:', err);
    } else {
      console.log('✅ Base de datos cerrada correctamente.');
    }
  });
  process.exit();
});
