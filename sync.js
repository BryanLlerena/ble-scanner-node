// Módulo de sincronización con API - similar a beaconSync.ts
require('dotenv').config();
const https = require('https');
const http = require('http');
const logger = require('./logger');
const wifi = require('node-wifi');

// Inicializar módulo wifi
wifi.init({ iface: null });

// Configuración desde variables de entorno
const UNIT = process.env.UNIT || "TEST_UNIT";

// Configuración de la API desde variables de entorno
const API_BASE_URL = process.env.API_BASE_URL || "http://172.236.110.18:3001/api/v1";
const API_ENDPOINTS = {
  BEACON_TRACK_MANY: `${API_BASE_URL}/beacon-track/many`,
  BEACON_TRACK_UPDATE: `${API_BASE_URL}/beacon-track`
};

// Configuración de verificación de internet
const SKIP_INTERNET_CHECK = process.env.SKIP_INTERNET_CHECK === 'true' || false;

// Headers por defecto
const DEFAULT_HEADERS = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'BeaconApp/1.0 (NodeJS)'
};

function getWifiInfo() {
  return new Promise((resolve, reject) => {
    wifi.getCurrentConnections((err, currentConnections) => {
      if (err) {
        return reject(err);
      }
      if (currentConnections.length > 0) {
        const { ssid, mac } = currentConnections[0];
        resolve({ ssid, bssid: mac });
      } else {
        resolve({ ssid: null, bssid: null });
      }
    });
  });
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

// Obtener eventos pendientes de sincronización
function getPendingEvents(db) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM beacon_events 
      WHERE syncStatus = 'pending'
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

// Marcar eventos como sincronizados
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
      discardArray= JSON.parse(event.rssi_discard);
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
    rssi: validRssiArray,
    rssi_discard: discardArray,
    wap: wap.wap || "",
    wap_mac: wap.wap_mac || ""
  };
}

// Generar UUID simple
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Enviar eventos nuevos (POST /many)
async function sendNewBeaconEvents(db) {
  let wifiInfo = { wap: "", wap_mac: "" };
  try {
    const pendingEvents = await getPendingEvents(db);

    await getWifiInfo().then(info => {
      wifiInfo.wap = info.ssid;
      wifiInfo.wap_mac = info.bssid;
    }).catch(console.error);

    console.log(wifiInfo);

    if (pendingEvents.length === 0) {
      logger.debug('📡 No hay eventos pendientes para enviar');
      return { success: true, sent: 0 };
    }
    
    logger.info(`📡 Enviando ${pendingEvents.length} eventos nuevos...`);
    
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
      
      logger.info(`✅ ${pendingEvents.length} eventos enviados exitosamente`);
      return { success: true, sent: pendingEvents.length };
    } else {
      logger.error(`❌ Error enviando eventos: HTTP ${response.status}`);
      return { success: false, error: `HTTP ${response.status}`, sent: 0 };
    }
    
  } catch (error) {
    logger.error('❌ Error en sendNewBeaconEvents:', error.message);
    return { success: false, error: error.message, sent: 0 };
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

    console.log(wifiInfo);

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
    // Enviar eventos nuevos
    const newResults = await sendNewBeaconEvents(db);
    
    // Actualizar eventos existentes
    const updateResults = await updateExistingBeaconEvents(db);
    
    const totalProcessed = newResults.sent + updateResults.updated;
    
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

module.exports = {
  syncBeaconEvents,
  checkInternetConnection,
  sendNewBeaconEvents,
  updateExistingBeaconEvents
};
