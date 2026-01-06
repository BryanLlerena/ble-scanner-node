// BLE Scanner - MODO HÍBRIDO: Qt Scanner + Node.js Services  
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const logger = require('./logger');

// Configuración desde variables de entorno
const BEACON_TIMEOUT = parseInt(process.env.BEACON_TIMEOUT) || 3000;
const DB_FILE = process.env.DB_FILE || "beacons.db";

logger.info('🔀 MODO HÍBRIDO: Qt Scanner + Node.js Services');
logger.info('   📡 Scanning BLE: Qt Scanner (nativo)');
logger.info('   🔧 Node.js: Timeouts, stats, monitoreo');
logger.info(`   💾 DB_FILE: ${DB_FILE}`);
logger.info(`   ⏱️  BEACON_TIMEOUT: ${BEACON_TIMEOUT}s`);

// Configuración de la base de datos (compartida con Qt Scanner)
const db = new sqlite3.Database(DB_FILE);

// Verificar que la tabla existe (creada por Qt Scanner)
db.serialize(() => {
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='beacon_events'", (err, row) => {
    if (err) {
      logger.error('❌ Error verificando DB:', err);
    } else if (row) {
      logger.info('✅ Tabla beacon_events encontrada - Compatible con Qt');
    } else {
      logger.warn('⚠️ Tabla beacon_events no encontrada - ¿Qt Scanner corriendo?');
    }
  });
});

// Función para cerrar evento
function closeBeaconEvent(eventId, deviceMac) {
  logger.info(`🔒 Cerrando evento ${eventId} para beacon: ${deviceMac}`);
  
  db.run(
    `UPDATE beacon_events SET eventState = 'closed', syncStatus = CASE 
       WHEN syncStatus = 'sent' THEN 'updated' 
       ELSE syncStatus 
     END WHERE id = ?`,
    [eventId],
    err => {
      if (err) {
        logger.error('❌ Error cerrando evento:', err);
      } else {
        logger.info(`✅ Evento ${eventId} cerrado`);
      }
    }
  );
}

// Función para obtener evento abierto por MAC (solo últimos 12 horas)
function getOpenEventByMac(mac, callback) {
  // Calcular timestamp de hace 1 hora
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  db.get(
    `SELECT * FROM beacon_events 
     WHERE beaconMac = ? 
     AND eventState = 'open' 
     AND f_inicio >= ? 
     ORDER BY id DESC 
     LIMIT 1`,
    [mac, oneHourAgo],
    (err, row) => {
      if (err) {
        logger.error('❌ Error buscando evento abierto:', err);
        callback(err, null);
      } else {
        callback(null, row);
      }
    }
  );
}

// Función para cerrar eventos de beacons que han desaparecido (timeout)
function closeExpiredBeaconEvents() {
  const now = Date.now();
  // Verificando beacons expirados
  
  // Obtener todos los eventos abiertos
  db.all(
    `SELECT id, beaconMac, f_final FROM beacon_events WHERE eventState = 'open'`,
    (err, openEvents) => {
      if (err) {
        logger.error('❌ Error obteniendo eventos abiertos:', err);
        return;
      }
      
      if (openEvents.length === 0) {
        // No hay eventos abiertos
        return;
      }
      
      // Verificando eventos abiertos
      
      openEvents.forEach(event => {
        const lastFinalTime = new Date(event.f_final).getTime();
        
        // Si no hay registro de última vez visto, usar f_final del evento
        const timeToCheck = lastFinalTime;
        const timeSinceLastSeen = (now - timeToCheck) / 1000; // en segundos
        
        if (timeSinceLastSeen > BEACON_TIMEOUT) {
          logger.warn(`⏰ Beacon ${event.beaconMac} perdido por ${Math.round(timeSinceLastSeen)}s - cerrando evento ${event.id}`);
          closeBeaconEvent(event.id, event.beaconMac);
        } else {
          // Beacon activo
        }
      });
    }
  );
}

// Parsear iBeacon
function parseIBeacon(manufacturerData) {
  if (!manufacturerData || manufacturerData.length < 25) return null;
  
  if (manufacturerData[0] === 0x4c && manufacturerData[1] === 0x00 && 
      manufacturerData[2] === 0x02 && manufacturerData[3] === 0x15) {
    
    const uuidArr = manufacturerData.slice(4, 20);
    const uuid = `${uuidArr.slice(0,4).map(b=>b.toString(16).padStart(2,'0')).join('')}-`+
      `${uuidArr.slice(4,6).map(b=>b.toString(16).padStart(2,'0')).join('')}-`+
      `${uuidArr.slice(6,8).map(b=>b.toString(16).padStart(2,'0')).join('')}-`+
      `${uuidArr.slice(8,10).map(b=>b.toString(16).padStart(2,'0')).join('')}-`+
      `${uuidArr.slice(10,16).map(b=>b.toString(16).padStart(2,'0')).join('')}`;
    
    const major = (manufacturerData[20] << 8) | manufacturerData[21];
    const minor = (manufacturerData[22] << 8) | manufacturerData[23];
    
    const txPowerRaw = manufacturerData[24];
    const txPower = txPowerRaw > 127 ? txPowerRaw - 256 : txPowerRaw;
    
    return { type: 'iBeacon', uuid, major, minor, txPower };
  }
  return null;
}

// Parsear Eddystone
function parseEddystone(serviceData) {
  if (!serviceData) return null;
  
  // Buscar el servicio Eddystone (FEAA)
  for (let uuid in serviceData) {
    if (uuid.toLowerCase().includes('feaa')) {
      const data = serviceData[uuid];
      if (data && data.length > 0 && data[0] === 0x00) { // Frame type UID
        const namespace = data.slice(2, 12).map(b => b.toString(16).padStart(2, '0')).join('');
        const instance = data.slice(12, 18).map(b => b.toString(16).padStart(2, '0')).join('');
        return { type: 'Eddystone-UID', namespace, instance };
      }
    }
  }
  return null;
}

// Funciones de Noble removidas - ahora usamos bluetoothctl

// Parsear datos de beacon desde bluetoothctl
function parseBeaconData(line) {
  let mac, rssi = -70, deviceName = '';
  
  // Procesar nuevos dispositivos: [NEW] Device AA:BB:CC:DD:EE:FF Name
  if (line.includes('[NEW] Device')) {
    const newMatch = line.match(/\[NEW\] Device ([A-Fa-f0-9:]{17})(?:\s+(.*))?/);
    if (!newMatch) return null;
    
    mac = newMatch[1].toLowerCase();
    deviceName = newMatch[2] || 'Sin nombre';
    rssi = -60; // RSSI por defecto para nuevos dispositivos
    
    // Solo mostrar dispositivos objetivo
    const isTarget = mac.startsWith(TARGET_MAC_PREFIX.toLowerCase());
    if (isTarget && !detectedMACs.has(mac)) {
      detectedMACs.add(mac);
      
      logger.info(`🎯 Nuevo beacon detectado: ${mac.toUpperCase()} | RSSI: ${rssi} dBm`);
    }
  }
  // Procesar cambios de RSSI: [CHG] Device AA:BB:CC:DD:EE:FF RSSI: -XX
  else if (line.includes('[CHG] Device') && line.includes('RSSI:')) {
    const chgMatch = line.match(/\[CHG\] Device ([A-Fa-f0-9:]{17}).*RSSI:\s*(-?\d+)/);
    if (!chgMatch) return null;
    mac = chgMatch[1].toLowerCase();
    rssi = parseInt(chgMatch[2]);
    deviceName = 'LS_Beacon_V8.4'; // Nombre por defecto para CHG events
    
    // Mostrar TODAS las actualizaciones de RSSI para dispositivos objetivo
    const isTarget = mac.startsWith(TARGET_MAC_PREFIX.toLowerCase());
    if (isTarget) {
      // Beacon RSSI actualizado
    }
  }
  else {
    return null;
  }
  
  // Solo procesar beacons objetivo para la base de datos
  if (!mac || !mac.startsWith(TARGET_MAC_PREFIX.toLowerCase())) return null;
  
  const distance = calculateDistanceInM(rssi);
  
  return {
    deviceId: mac,
    mac,
    name: deviceName || 'BLE Device',
    rssi,
    distance,
    distanceInM: distance,
    timestamp: Date.now(),
    isBeacon: true,
    type: 'BLE',
    manufacturerData: null,
    serviceData: null
  };
}

// Función processDevice removida - bluetoothctl usa parseBeaconData directamente

// Iniciar escaneo BLE con bluetoothctl (optimizado para Yocto)
function startBLEScan() {
  logger.info('📡 Iniciando escaneo BLE con bluetoothctl...');
  
  // Reset completo del Bluetooth
  logger.info('🔄 Ejecutando reset de Bluetooth hci0...');
  exec('hciconfig hci0 down && sleep 1 && hciconfig hci0 up && sleep 2', (err) => {
    if (err) {
      logger.error('❌ Error reseteando hci0:', err.message);
      logger.info('🔄 Reintentando en 10 segundos...');
      setTimeout(startBLEScan, 10000);
      return;
    }
    
    logger.info('✅ Bluetooth reseteado correctamente');
    
    // Iniciar bluetoothctl
    scanProcess = spawn('bluetoothctl', [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let lastDeviceTime = Date.now();
    
    // Configurar bluetoothctl paso a paso
    setTimeout(() => {
      scanProcess.stdin.write('power on\n');
      logger.info('🔌 Bluetooth power on');
    }, 500);
    
    setTimeout(() => {
      scanProcess.stdin.write('agent on\n');
      logger.info('👤 Agent activado');
    }, 1000);
    
    // Filtros de bluetoothctl removidos - no compatibles con esta versión
    
    setTimeout(() => {
      scanProcess.stdin.write('scan on\n');
      logger.info('🔍 Escaneo BLE iniciado (sin filtros adicionales)');
      logger.info('⏰ Watchdog activado - reiniciará si no hay actividad por 120s');
      
      // Watchdog para detectar inactividad
      watchdogTimer = setInterval(() => {
        const timeSinceLastDevice = Date.now() - lastDeviceTime;
        const secondsSinceLastDevice = Math.floor(timeSinceLastDevice / 1000);
        
        logger.info(`💓 Watchdog: ${secondsSinceLastDevice}s sin actividad BLE`);
        
        if (timeSinceLastDevice > 120000) { // 120 segundos sin dispositivos
          logger.warn('⚠️ Sin actividad BLE por 120s - reiniciando scanner...');
          clearInterval(watchdogTimer);
          if (preventiveRestartTimer) {
            clearTimeout(preventiveRestartTimer);
          }
          if (scanProcess) {
            scanProcess.kill('SIGTERM');
          }
          setTimeout(startBLEScan, 3000);
        }
      }, 10000); // Check cada 10 segundos para más visibilidad
      
    }, 1500);
    
    scanProcess.stdout.on('data', (data) => {
      const rawOutput = data.toString();
      // Solo log de output si contiene dispositivos objetivo
      const containsTargetDevice = rawOutput.toLowerCase().includes(TARGET_MAC_PREFIX.toLowerCase());
      // Solo procesar output con dispositivos objetivo
      
      const lines = rawOutput.split('\n');
      
      lines.forEach((line, index) => {
        line = line.trim();
        if (!line) return;
        
        // Debug: mostrar líneas con dispositivos objetivo
        // Procesar líneas con dispositivos objetivo
        
        // Limpiar línea de caracteres de control y códigos ANSI
        const cleanLine = line
          .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remover caracteres de control
          .replace(/\x1b\[[0-9;]*[mGKH]/g, '') // Remover códigos ANSI
          .replace(/\[[0-9;]*m/g, '') // Remover códigos de color restantes
          .replace(/\[K/g, '') // Remover clear line
          .trim();
        
        // Solo procesar líneas de dispositivos con nuestro prefijo objetivo
        if (/\[NEW\]\s+Device/.test(cleanLine) || (/\[CHG\]\s+Device/.test(cleanLine) && cleanLine.includes('RSSI'))) {
          const macMatch = cleanLine.match(/([A-Fa-f0-9:]{17})/);
          
          if (macMatch && macMatch[1].toLowerCase().startsWith(TARGET_MAC_PREFIX.toLowerCase())) {
            lastDeviceTime = Date.now();
            
            // Parsear y procesar beacon objetivo
            const beaconData = parseBeaconData(cleanLine);
            if (beaconData) {
              logger.info(`🎯 Beacon objetivo procesado: ${macMatch[1].toUpperCase()}`);
              processDetectedDevice(beaconData);
            }
          }
        }
      });
    });
    
    scanProcess.stderr.on('data', (data) => {
      logger.error('❌ Error bluetoothctl:', data.toString());
    });
    
    scanProcess.on('close', (code) => {
      logger.warn(`🔄 Bluetoothctl cerrado (código ${code}) - reiniciando...`);
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
      }
      if (preventiveRestartTimer) {
        clearTimeout(preventiveRestartTimer);
      }
      setTimeout(startBLEScan, 8000);
    });
    
    // Reinicio preventivo cada 10 minutos (importante en Yocto)
    preventiveRestartTimer = setTimeout(() => {
      logger.info('🔄 Reinicio preventivo del scanner (10min)');
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
      }
      if (preventiveRestartTimer) {
        clearTimeout(preventiveRestartTimer);
      }
      if (scanProcess) {
        scanProcess.kill('SIGTERM');
      }
      setTimeout(startBLEScan, 5000);
    }, 600000); // 10 minutos
  });
}

// Función para procesar dispositivo individual (lógica de debounce)
function processDetectedDevice(device) {
  if (!device || !device.isBeacon || !device.mac.startsWith(TARGET_MAC_PREFIX)) {
    return;
  }
  
  // Procesando dispositivo detectado
  
  logger.info(`🎯 Beacon detectado: ${device.name} ${device.type} | MAC=${device.mac} | RSSI=${device.rssi} | Distancia=${device.distanceInM.toFixed(2)}m`);
  
  getOpenEventByMac(device.mac, (err, currentEvent) => {
    if (err) {
      logger.error('❌ Error consultando evento:', err);
      return;
    }

    if (currentEvent) {
      const timeSinceLastUpdate = (Date.now() - new Date(currentEvent.f_final).getTime()) / 1000;
      if (timeSinceLastUpdate < DEBOUNCE_TIME) {
        // Dentro del tiempo de gracia - actualizar siempre
        updateBeaconEvent(device, currentEvent.id);
      } else {
        closeBeaconEvent(currentEvent.id, device.mac);
        if(device.distanceInM <= SCAN_RANGE){
          saveBeaconEvent(device);
        }
      }
    } else if (device.distanceInM <= SCAN_RANGE) {
      saveBeaconEvent(device);
    }
  });
}

// Iniciar escaneo BLE
startBLEScan();

// Verificar beacons perdidos cada 30 segundos
// Función principal según el modo
function main() {
  if (isHybridMode) {
    startHybridMode();
  } else {
    startTraditionalMode();
  }
}

// Modo híbrido: Solo servicios, sin scanning
function startHybridMode() {
  logger.info('🔀 Iniciando servicios Node.js en modo híbrido...');
  logger.info('   📡 Scanning: Delegado a Qt BLE Scanner');
  logger.info('   🔧 Node.js: Timeouts, estadísticas, verificaciones');
  
  // Solo funciones de monitoreo, no scanning
  setInterval(closeExpiredBeaconEvents, 30000);
  setInterval(showDatabaseStats, 5 * 60 * 1000);
  setInterval(checkQtScannerActivity, 2 * 60 * 1000);
  
  // Estadísticas iniciales
  setTimeout(showDatabaseStats, 2000);
  setTimeout(checkQtScannerActivity, 5000);
  
  logger.info('✅ Servicios híbridos iniciados');
}

// Modo tradicional: Con bluetoothctl (tu código actual)
function startTraditionalMode() {
  logger.info('📡 Iniciando modo tradicional con bluetoothctl...');
  
  // Tu código actual de scanning
  setInterval(closeExpiredBeaconEvents, 30000);
  startBLEScan();
}

// Funciones adicionales para modo híbrido
function showDatabaseStats() {
  db.get(
    `SELECT 
       COUNT(*) as total,
       COUNT(CASE WHEN eventState = 'open' THEN 1 END) as open_events,
       COUNT(CASE WHEN DATE(timestamp) = DATE('now') THEN 1 END) as today_events,
       COUNT(CASE WHEN syncStatus = 'pending' THEN 1 END) as pending_sync
     FROM beacon_events`,
    (err, stats) => {
      if (err) {
        logger.error('❌ Error obteniendo estadísticas:', err);
        return;
      }
      
      logger.info('📊 Stats DB: Total=' + stats.total + 
                  ', Abiertos=' + stats.open_events + 
                  ', Hoy=' + stats.today_events + 
                  ', Pendientes=' + stats.pending_sync);
    }
  );
}

function checkQtScannerActivity() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  db.get(
    `SELECT COUNT(*) as recent_count FROM beacon_events WHERE timestamp >= ?`,
    [fiveMinutesAgo],
    (err, result) => {
      if (err) {
        logger.error('❌ Error verificando actividad Qt:', err);
        return;
      }
      
      if (result.recent_count > 0) {
        logger.info(`✅ Qt Scanner activo - ${result.recent_count} eventos en últimos 5min`);
      } else {
        logger.warn('⚠️ Qt Scanner inactivo - No hay eventos recientes');
      }
    }
  );
}

setInterval(closeExpiredBeaconEvents, 30000);

// Inicializar según el modo
if (!isHybridMode) {
  // Solo iniciar scanning si NO es modo híbrido
  startBLEScan();
}

process.on('SIGINT', () => {
  logger.info('\n🛑 Finalizando aplicación...');
  
  // Detener bluetoothctl solo si NO es modo híbrido
  if (!isHybridMode && scanProcess && !scanProcess.killed) {
    logger.info('🔌 Deteniendo bluetoothctl...');
    scanProcess.kill('SIGTERM');
  }
  
  // Limpiar timers
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
  }
  if (preventiveRestartTimer) {
    clearTimeout(preventiveRestartTimer);
  }
  
  db.close((err) => {
    if (err) {
      logger.error('❌ Error cerrando base de datos:', err);
    } else {
      logger.info('✅ Base de datos cerrada correctamente.');
    }
  });
  
  process.exit();
});

// Iniciar aplicación según el modo
main();
