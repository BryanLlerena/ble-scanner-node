// Módulo de sincronización con API - similar a beaconSync.ts
require('dotenv').config();
const https = require('https');
const http = require('http');

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
    console.log('🌐 Verificando conexión DNS...');
    const dnsResult = await dnsTest();
    if (dnsResult) {
      console.log('✅ Conexión DNS exitosa');
      return true;
    }

    // Si falla, probar servidor DNS alternativo
    console.log('🌐 Verificando DNS alternativo...');
    const dnsBackupResult = await dnsTestBackup();
    if (dnsBackupResult) {
      console.log('✅ Conexión DNS alternativa exitosa');
      return true;
    }

    console.log('❌ Sin conexión a internet detectada');
    return false;

  } catch (error) {
    console.log('❌ Error verificando conexión:', error.message);
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
function convertEventToApiFormat(event) {
  // Parsear arrays RSSI (solo usar datos válidos para estadísticas)
  let validRssiArray = [];
  let allRssiArray = [];
  
  try {
    // Datos válidos (dentro del rango) - para estadísticas
    if (event.rssi) {
      const parsedRssi = JSON.parse(event.rssi);
      validRssiArray = parsedRssi;
      allRssiArray = allRssiArray.concat(parsedRssi);
    }
    
    // Datos descartados (fuera del rango) - solo para array completo
    if (event.rssi_discard) {
      const parsedRssiDiscard = JSON.parse(event.rssi_discard);
      allRssiArray = allRssiArray.concat(parsedRssiDiscard);
    }
  } catch (parseErr) {
    console.error('Error parseando RSSI:', parseErr);
  }
  
  // Calcular estadísticas solo con datos válidos
  const stats = calculateBeaconStats(validRssiArray);
  
  return {
    mac: event.beaconMac,
    unit: event.unit || "Test Truck",
    f_inicio: event.f_inicio,
    f_final: event.f_final,
    duration: stats.duration,
    rssi_min: stats.rssi_min,
    rssi_max: stats.rssi_max,
    rssi_mean: stats.rssi_mean,
    distance: stats.distance,
    uuid: event.uuid || generateUUID(),
    connection: true, // Asumimos conexión disponible al enviar
    rssi: allRssiArray // Array completo (válidos + descartados) para referencia
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
  try {
    const pendingEvents = await getPendingEvents(db);
    
    if (pendingEvents.length === 0) {
      console.log('📡 No hay eventos pendientes para enviar');
      return { success: true, sent: 0 };
    }
    
    console.log(`📡 Enviando ${pendingEvents.length} eventos nuevos...`);
    
    // Convertir a formato API
    const payload = pendingEvents.map((e) => convertEventToApiFormat(e));
    console.log("payload", payload);
        console.log("pending", payload);


    // Enviar a la API
    const response = await makeHttpRequest(API_ENDPOINTS.BEACON_TRACK_MANY, {
      method: 'POST',
      headers: DEFAULT_HEADERS
    }, payload);
    
    if (response.ok) {
      // Marcar como enviados
      const eventIds = pendingEvents.map(event => event.id);
      await markEventsAsSent(db, eventIds);
      
      console.log(`✅ ${pendingEvents.length} eventos enviados exitosamente`);
      return { success: true, sent: pendingEvents.length };
    } else {
      console.error(`❌ Error enviando eventos: HTTP ${response.status}`);
      return { success: false, error: `HTTP ${response.status}`, sent: 0 };
    }
    
  } catch (error) {
    console.error('❌ Error en sendNewBeaconEvents:', error.message);
    return { success: false, error: error.message, sent: 0 };
  }
}

// Actualizar eventos existentes (PUT /:uuid)
async function updateExistingBeaconEvents(db) {
  try {
    const updateEvents = await getPendingUpdateEvents(db);
    
    if (updateEvents.length === 0) {
      return { success: true, updated: 0 };
    }
    
    console.log(`🔄 Actualizando ${updateEvents.length} eventos...`);
    
    let successCount = 0;
    
    for (const event of updateEvents) {
      try {
        const payload = convertEventToApiFormat(event);
        const updateUrl = `${API_ENDPOINTS.BEACON_TRACK_UPDATE}/${event.uuid}`;
        
        const response = await makeHttpRequest(updateUrl, {
          method: 'PUT',
          headers: DEFAULT_HEADERS
        }, payload);
        
        if (response.ok) {
          await markEventsAsSent(db, [event.id]);
          successCount++;
          console.log(`✅ Evento ${event.uuid} actualizado`);
        } else {
          console.error(`❌ Error actualizando evento ${event.uuid}: HTTP ${response.status}`);
        }
      } catch (updateError) {
        console.error(`❌ Error actualizando evento ${event.uuid}:`, updateError.message);
      }
    }
    
    return { success: true, updated: successCount };
    
  } catch (error) {
    console.error('❌ Error en updateExistingBeaconEvents:', error.message);
    return { success: false, error: error.message, updated: 0 };
  }
}

// Función principal de sincronización
async function syncBeaconEvents(db) {
  console.log('🌐 Iniciando sincronización con API...');
  
  // Verificar conexión a internet (opcional)
  if (!SKIP_INTERNET_CHECK) {
    const hasInternet = await checkInternetConnection();
    if (!hasInternet) {
      console.log('❌ Sin conexión a internet, saltando sincronización');
      return { success: false, error: 'No internet connection' };
    }
  } else {
    console.log('⚠️ Verificación de internet deshabilitada - intentando sincronización directa');
  }
  
  try {
    // Enviar eventos nuevos
    const newResults = await sendNewBeaconEvents(db);
    
    // Actualizar eventos existentes
    const updateResults = await updateExistingBeaconEvents(db);
    
    const totalProcessed = newResults.sent + updateResults.updated;
    
    if (totalProcessed > 0) {
      console.log(`✅ Sincronización completada: ${newResults.sent} nuevos, ${updateResults.updated} actualizados`);
    } else {
      console.log('📡 Sincronización completada: No hay datos pendientes');
    }
    
    return {
      success: true,
      newEvents: newResults.sent,
      updatedEvents: updateResults.updated,
      total: totalProcessed
    };
    
  } catch (error) {
    console.error('❌ Error en sincronización:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  syncBeaconEvents,
  checkInternetConnection,
  sendNewBeaconEvents,
  updateExistingBeaconEvents
};
