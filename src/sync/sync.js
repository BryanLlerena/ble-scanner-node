// Módulo de sincronización con API - similar a beaconSync.ts
require('dotenv').config();
const https = require('https');
const http = require('http');
const logger = require('../utils/logger');
const wifiUtils = require('../wifi/wifi-utils');

// Configuración desde variables de entorno
const UNIT = process.env.UNIT || "TEST_UNIT";

// Configuración de la API desde variables de entorno
const API_BASE_URL = process.env.API_BASE_URL || "http://172.236.110.18:3001/api/v1";
const API_ENDPOINTS = {
  BEACON_TRACK_MANY: `${API_BASE_URL}/beacon-track/many`,
  BEACON_TRACK_UPDATE: `${API_BASE_URL}/beacon-track`,
  SESSIONS_BATCH: `${API_BASE_URL}/sessions/batch`
};

// Configuración de verificación de internet
const SKIP_INTERNET_CHECK = process.env.SKIP_INTERNET_CHECK === 'true' || false;

// Headers por defecto
const DEFAULT_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'BeaconApp/1.0 (NodeJS)'
};

async function getWifiInfo() {
  return await wifiUtils.getWifiInfo();
}

// Función para verificar conexión a internet usando DNS lookup
async function checkInternetConnection() {
  const dns = require('dns');

  // Método DNS lookup (más ligero y rápido)
  const dnsTest = () => {
    return new Promise((resolve) => {
      dns.lookup('google.com', { timeout: 3000 }, (err) => {
        resolve(!err);
      });
    });
  };

  // Método DNS alternativo como respaldo
  const dnsTestBackup = () => {
    return new Promise((resolve) => {
      dns.lookup('cloudflare.com', { timeout: 3000 }, (err) => {
        resolve(!err);
      });
    });
  };

  try {
    // Probar DNS lookup primero (más eficiente)
    logger.debug('🌐 Verificando conexión DNS...');
    const dnsResult = await dnsTest();
    if (dnsResult) {
      logger.debug('✅ Conexión DNS exitosa');
      return true;
    }

    // Si falla, probar servidor DNS alternativo
    logger.debug('🌐 Verificando DNS alternativo...');
    const dnsBackupResult = await dnsTestBackup();
    if (dnsBackupResult) {
      logger.debug('✅ Conexión DNS alternativa exitosa');
      return true;
    }

    logger.warn('❌ Sin conexión a internet detectada');
    return false;

  } catch (error) {
    logger.warn('❌ Error verificando conexión:', error.message);
    return false;
  }
}

// Función para hacer peticiones HTTP
function makeHttpRequest(url, options, data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname,
      method: options.method || 'GET',
      headers: options.headers || DEFAULT_HEADERS,
      timeout: 10000
    };

    const req = httpModule.request(requestOptions, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          data: responseData
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Calcular estadísticas RSSI (similar a CalculateBeaconEventStats)
function calculateBeaconStats(rssiArray) {
  if (!rssiArray || rssiArray.length === 0) {
    return {
      rssi_min: 0,
      rssi_max: 0,
      rssi_mean: 0,
      distance: 0,
      duration: 0
    };
  }

  const rssiValues = rssiArray.map(entry => entry.rssi);
  const distances = rssiArray.map(entry => entry.distance);
  const timestamps = rssiArray.map(entry => entry.datetime);

  const rssi_min = Math.min(...rssiValues);
  const rssi_max = Math.max(...rssiValues);
  const rssi_mean = rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length;
  const distance = distances.reduce((a, b) => a + b, 0) / distances.length;

  // Calcular duración desde primera hasta última lectura
  const firstTimestamp = Math.min(...timestamps);
  const lastTimestamp = Math.max(...timestamps);
  const duration = (lastTimestamp - firstTimestamp) / 1000; // en segundos

  return {
    rssi_min: Math.round(rssi_min),
    rssi_max: Math.round(rssi_max),
    rssi_mean: Math.round(rssi_mean),
    distance: Math.round(distance * 100) / 100, // 2 decimales
    duration: Math.round(duration)
  };
}

// Obtener eventos pendientes de sincronización (con límite)
function getPendingEvents(db, limit = 500) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM beacon_events 
      WHERE syncStatus = 'pending'
      ORDER BY id ASC
      LIMIT ?
    `, [limit], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

// Obtener sesiones cerradas pendientes de enviar a /sessions/batch
function getPendingClosedSessions(db, limit = 500) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM beacon_events 
      WHERE eventState = 'closed' AND batch_sent = 0
      ORDER BY id ASC
      LIMIT ?
    `, [limit], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

// Obtener eventos que necesitan actualización
function getPendingUpdateEvents(db) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM beacon_events 
      WHERE syncStatus = 'updated'
      ORDER BY id ASC
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

// Marcar eventos como enviados
function markEventsAsSent(db, eventIds) {
  return new Promise((resolve, reject) => {
    const placeholders = eventIds.map(() => '?').join(',');
    db.run(`
      UPDATE beacon_events 
      SET syncStatus = 'sent', syncTimestamp = ? 
      WHERE id IN (${placeholders})
    `, [new Date().toISOString(), ...eventIds], (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// Marcar eventos cerrados como batch enviados
function markEventsAsBatchSent(db, eventIds) {
  return new Promise((resolve, reject) => {
    const placeholders = eventIds.map(() => '?').join(',');
    db.run(`
      UPDATE beacon_events 
      SET batch_sent = 1, syncTimestamp = ? 
      WHERE id IN (${placeholders})
    `, [new Date().toISOString(), ...eventIds], (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// Convertir evento de BD a formato API
function convertEventToApiFormat(event, wap) {
  // Parsear arrays RSSI (solo usar datos válidos para estadísticas)
  let validRssiArray = [];
  let discardArray = [];

  try {
    if (event.rssi) {
      validRssiArray = JSON.parse(event.rssi);
    }

    if (event.rssi_discard) {
      discardArray = JSON.parse(event.rssi_discard);
    }
  } catch (parseErr) {
    logger.error('Error parseando RSSI:', parseErr);
  }

  // Calcular estadísticas solo con datos válidos
  const stats = calculateBeaconStats(validRssiArray);


  return {
    mac: event.beaconMac,
    unit: event.unit || UNIT,
    f_inicio: new Date(event.f_inicio).getTime(),
    f_final: new Date(event.f_final).getTime(),
    duration: stats.duration,
    rssi_min: stats.rssi_min,
    rssi_max: stats.rssi_max,
    rssi_mean: stats.rssi_mean,
    distance: stats.distance,
    uuid: event.uuid || generateUUID(),
    connection: "offline",
    rssi: [],
    rssi_discard: [],
    wap: wap.wap || "",
    wap_mac: wap.wap_mac || ""
  };
}

// Generar UUID simple
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Enviar eventos nuevos (POST /many) - por lotes de 500
async function sendNewBeaconEvents(db) {
  const BATCH_SIZE = 500;
  let totalSent = 0;
  let wifiInfo = { wap: "", wap_mac: "" };

  try {
    await getWifiInfo().then(info => {
      wifiInfo.wap = info.ssid;
      wifiInfo.wap_mac = info.bssid;
    }).catch(console.error);

    // Enviar en lotes hasta que no haya más pendientes
    while (true) {
      const pendingEvents = await getPendingEvents(db, BATCH_SIZE);

      if (pendingEvents.length === 0) {
        if (totalSent === 0) {
          logger.debug('📡 No hay eventos pendientes para enviar');
        }
        return { success: true, sent: totalSent };
      }

      logger.info(`📡 Enviando lote de ${pendingEvents.length} eventos...`);

      // Convertir a formato API
      const payload = pendingEvents.map((e) => convertEventToApiFormat(e, wifiInfo));

      // Enviar a la API
      const response = await makeHttpRequest(API_ENDPOINTS.BEACON_TRACK_MANY, {
        method: 'POST',
        headers: DEFAULT_HEADERS
      }, payload);

      if (response.ok) {
        // Marcar como enviados
        const eventIds = pendingEvents.map(event => event.id);
        await markEventsAsSent(db, eventIds);

        totalSent += pendingEvents.length;
        logger.info(`✅ Lote enviado: ${pendingEvents.length} beacons (Total: ${totalSent})`);

        // Si envió menos del lote completo, ya no hay más pendientes
        if (pendingEvents.length < BATCH_SIZE) {
          logger.info(`✅ Sincronización beacons completada: ${totalSent} eventos enviados`);
          return { success: true, sent: totalSent };
        }

        // Continuar con siguiente lote
        continue;
      } else {
        logger.error(`❌ Error enviando lote beacons: HTTP ${response.status}`);
        return { success: false, error: `HTTP ${response.status}`, sent: totalSent };
      }
    }

  } catch (error) {
    logger.error('❌ Error en sendNewBeaconEvents:', error.message);
    return { success: false, error: error.message, sent: totalSent };
  }
}

// Actualizar eventos existentes (PUT /:uuid)
async function updateExistingBeaconEvents(db) {
  let wifiInfo = { wap: "", wap_mac: "" };
  try {
    const updateEvents = await getPendingUpdateEvents(db);

    await getWifiInfo().then(info => {
      wifiInfo.wap = info.ssid;
      wifiInfo.wap_mac = info.bssid;
    }).catch(console.error);

    if (updateEvents.length === 0) {
      return { success: true, updated: 0 };
    }

    logger.info(`🔄 Actualizando ${updateEvents.length} eventos...`);

    let successCount = 0;

    for (const event of updateEvents) {
      try {
        const payload = convertEventToApiFormat(event, wifiInfo);
        const updateUrl = `${API_ENDPOINTS.BEACON_TRACK_UPDATE}/${event.uuid}`;

        const response = await makeHttpRequest(updateUrl, {
          method: 'PUT',
          headers: DEFAULT_HEADERS
        }, payload);

        if (response.ok) {
          await markEventsAsSent(db, [event.id]);
          successCount++;
          logger.info(`✅ Evento ${event.uuid} actualizado`);
        } else {
          logger.error(`❌ Error actualizando evento ${event.uuid}: HTTP ${response.status}`);
        }
      } catch (updateError) {
        logger.error(`❌ Error actualizando evento ${event.uuid}:`, updateError.message);
      }
    }

    return { success: true, updated: successCount };

  } catch (error) {
    logger.error('❌ Error en updateExistingBeaconEvents:', error.message);
    return { success: false, error: error.message, updated: 0 };
  }
}

// Enviar sesiones cerradas al nuevo endpoint (POST /sessions/batch)
async function sendClosedSessionsBatch(db) {
  const BATCH_SIZE = 500;
  let totalSent = 0;
  let wifiInfo = { wap: "", wap_mac: "" };

  try {
    await getWifiInfo().then(info => {
      wifiInfo.wap = info.ssid;
      wifiInfo.wap_mac = info.bssid;
    }).catch(console.error);

    // Enviar en lotes hasta que no haya más pendientes
    while (true) {
      const closedSessions = await getPendingClosedSessions(db, BATCH_SIZE);

      if (closedSessions.length === 0) {
        if (totalSent === 0) {
          logger.info('📡 No hay sesiones cerradas pendientes para /sessions/batch');
        }
        return { success: true, sent: totalSent };
      }

      logger.info(`📡 Enviando lote de ${closedSessions.length} sesiones cerradas a batch...`);

      // Convertir a formato API de batches
      const payload = {
        unitId: UNIT,
        sessions: closedSessions.map((e) => {
          const apiFormat = convertEventToApiFormat(e, wifiInfo);
          return {
            id: apiFormat.uuid,
            address: apiFormat.mac,
            name: e.name || 'Unknown',
            firstSeen: new Date(apiFormat.f_inicio).toISOString(),
            lastSeen: new Date(apiFormat.f_final).toISOString(),
            durationMs: apiFormat.duration * 1000
          };
        })
      };

      // Enviar a la API
      const response = await makeHttpRequest(API_ENDPOINTS.SESSIONS_BATCH, {
        method: 'POST',
        headers: DEFAULT_HEADERS
      }, payload);

      if (response.ok) {
        // Marcarlos como finalizados usando un estado definitivo para no re-sincronizarlos
        const sessionIds = closedSessions.map(event => event.id);

        try {
          await markEventsAsBatchSent(db, sessionIds);
        } catch (dbErr) {
          logger.error(`❌ Error marcando lote batch_sent en SQLite:`, dbErr.message);
          // Opcional: break o continuar, pero mejor no return error para no colapsar la app
        }

        totalSent += closedSessions.length;
        logger.info(`✅ Lote sessions/batch enviado: ${closedSessions.length} (Total: ${totalSent})`);

        if (closedSessions.length < BATCH_SIZE) {
          logger.info(`✅ Sincronización batch completada: ${totalSent} sesiones enviadas`);
          return { success: true, sent: totalSent };
        }
      } else {
        logger.error(`❌ Error enviando lote a sessions/batch: HTTP ${response.status}`);
        return { success: false, error: `HTTP ${response.status}`, sent: totalSent };
      }
    }
  } catch (error) {
    logger.error('❌ Error en sendClosedSessionsBatch:', error.message);
    return { success: false, error: error.message, sent: totalSent };
  }
}


// Función principal de sincronización
async function syncBeaconEvents(db) {
  logger.info('🌐 Iniciando sincronización con API...');

  // Verificar conexión a internet (opcional)
  if (!SKIP_INTERNET_CHECK) {
    const hasInternet = await checkInternetConnection();
    if (!hasInternet) {
      logger.warn('❌ Sin conexión a internet, saltando sincronización');
      return { success: false, error: 'No internet connection' };
    }
  } else {
    logger.warn('⚠️ Verificación de internet deshabilitada - intentando sincronización directa');
  }

  try {
    // Enviar eventos nuevos (Beacon Tracker V1 actual)
    const newResults = await sendNewBeaconEvents(db);

    // Actualizar eventos existentes (Beacon Tracker V1 actual)
    const updateResults = await updateExistingBeaconEvents(db);

    // --- NUEVO ---
    // Enviar sesiones que ya estén "closed" al nuevo endpoint /sessions/batch
    let batchResults = { sent: 0 };
    try {
      logger.debug('🚀 Iniciando fase de sesiones batch...');
      batchResults = await sendClosedSessionsBatch(db);
    } catch (batchErr) {
      logger.error('❌ Error no capturado en sendClosedSessionsBatch:', batchErr.message);
    }

    const totalProcessed = newResults.sent + updateResults.updated + batchResults.sent;

    if (totalProcessed > 0) {
      logger.info(`✅ Sincronización completada: ${newResults.sent} nuevos, ${updateResults.updated} actualizados`);
    } else {
      logger.debug('📡 Sincronización completada: No hay datos pendientes');
    }

    return {
      success: true,
      newEvents: newResults.sent,
      updatedEvents: updateResults.updated,
      total: totalProcessed
    };

  } catch (error) {
    logger.error('❌ Error en sincronización:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// FUNCIONES DE SINCRONIZACIÓN DE GPS
// ============================================================================

// Obtener datos GPS pendientes de sincronización (con límite)
function getPendingGPSData(db, limit = 500) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM gps_data 
      WHERE syncStatus = 'pending'
      ORDER BY id ASC
      LIMIT ?
    `, [limit], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

// Marcar GPS como sincronizados
function markGPSAsSent(db, gpsIds) {
  return new Promise((resolve, reject) => {
    const placeholders = gpsIds.map(() => '?').join(',');
    db.run(`
      UPDATE gps_data 
      SET syncStatus = 'sent', syncTimestamp = ? 
      WHERE id IN (${placeholders})
    `, [new Date().toISOString(), ...gpsIds], (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// Enviar datos GPS al API (por lotes de 500)
async function syncGPSData(db) {
  const BATCH_SIZE = 100; // Enviar máximo 500 por vez
  let totalSent = 0;
  // No es necesario obtener info de WiFi
  try {
    // Configurar endpoint GPS
    const GPS_ENDPOINT = `${API_BASE_URL}/gps-data`;

    // Enviar en lotes hasta que no haya más pendientes
    while (true) {
      const pendingGPS = await getPendingGPSData(db, BATCH_SIZE);

      if (pendingGPS.length === 0) {
        if (totalSent === 0) {
          logger.debug('📍 No hay datos GPS pendientes para enviar');
        }
        return { success: true, sent: totalSent };
      }

      logger.info(`📍 Enviando lote de ${pendingGPS.length} registros GPS...`);

      // Imprimir el primer objeto que llega de la base de datos para ver qué campos tiene el JSON original
      if (pendingGPS.length > 0) {
        console.log("----- DEBUG GPS DATA -----");
        console.log(JSON.stringify(pendingGPS[0], null, 2));
        console.log("----------------------------");
      }

      // Convertir a formato API (solo datos GPS)
      const payload = pendingGPS.map(gps => ({
        unit: gps.unit || UNIT,
        latitude: gps.latitude,
        longitude: gps.longitude,
        fix: gps.fix,
        timestamp: gps.timestamp
      }));

      // Enviar a la API
      const response = await makeHttpRequest(GPS_ENDPOINT, {
        method: 'POST',
        headers: DEFAULT_HEADERS
      }, payload);

      if (response.ok) {
        // Marcar como enviados
        const gpsIds = pendingGPS.map(gps => gps.id);
        await markGPSAsSent(db, gpsIds);

        totalSent += pendingGPS.length;
        logger.info(`✅ Lote enviado: ${pendingGPS.length} GPS (Total: ${totalSent})`);

        // Si envió menos del lote completo, ya no hay más pendientes
        if (pendingGPS.length < BATCH_SIZE) {
          logger.info(`✅ Sincronización GPS completada: ${totalSent} registros enviados`);
          return { success: true, sent: totalSent };
        }

        // Continuar con siguiente lote
        continue;
      } else {
        logger.error(`❌ Error enviando lote GPS: HTTP ${response.status}`);
        return { success: false, error: `HTTP ${response.status}`, sent: totalSent };
      }
    }

  } catch (error) {
    logger.error('❌ Error en syncGPSData:', error.message);
    return { success: false, error: error.message, sent: totalSent };
  }
}

module.exports = {
  syncBeaconEvents,
  syncGPSData,
  checkInternetConnection,
  sendNewBeaconEvents,
  updateExistingBeaconEvents
};
