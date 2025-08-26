// BLE Scanner para Raspberry Pi usando noble y SQLite
const noble = require('@abandonware/noble');
const sqlite3 = require('sqlite3').verbose();

// Configuraciones (basadas en tu app React Native)
const SCAN_RANGE = 10; // metros - rango máximo de detección
const DEBOUNCE_TIME = 60; // segundos - tiempo de gracia para cerrar eventos
const TARGET_MAC_PREFIX = "BC:57:29"; // Solo procesar MACs que empiecen con esto
const UNIT = "TEST_UNIT"; // unidad o identificador del dispositivo

// Inicializar base de datos SQLite
const db = new sqlite3.Database('beacons.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS beacon_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deviceId TEXT,
    beaconMac TEXT,
    name TEXT,
    rssi TEXT,
    rssi_discard TEXT,
    timestamp TEXT,
    type TEXT,
    uuid TEXT,
    major INTEGER,
    minor INTEGER,
    txPower INTEGER,
    namespace TEXT,
    instance TEXT,
    distance REAL,
    distanceInM REAL,
    eventState TEXT DEFAULT 'open',
    f_inicio TEXT,
    f_final TEXT,
    unit TEXT,
    manufacturerData TEXT,
    serviceData TEXT
  )`);
  
  // Índices para mejorar performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_beacon_mac ON beacon_events(beaconMac)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_event_state ON beacon_events(eventState)`);
});

// Cache temporal para dispositivos detectados
const detectedDevicesCache = new Map();

// Calcular distancia basada en RSSI
function calculateDistance(rssi, txPower = -59) {
  if (rssi === 0) return -1;
  const n = 2.0;
  const distanceMeters = Math.pow(10, (txPower - rssi) / (10.0 * n));
  const distanceCm = distanceMeters * 100;
  
  if (distanceCm < 10) return 10;
  if (distanceCm > 10000) return 10000;
  
  return Math.round(distanceCm);
}

function calculateDistanceInM(rssi, txPower = -59) {
  if (rssi === 0) return -1;
  const n = 2.0;
  return Math.pow(10, (txPower - rssi) / (10.0 * n));
}

// Función para guardar evento de beacon (basada en tu lógica React Native)
function saveBeaconEvent(deviceData) {
  const timestamp = new Date().toISOString();
  console.log(`💾 Guardando nuevo evento para beacon: ${deviceData.mac}`);
  
  // Crear array inicial de RSSI según distancia
  const rssiEntry = {
    rssi: deviceData.rssi || 0,
    datetime: Date.now(),
    distance: deviceData.distanceInM
  };
  
  const rssi = deviceData.distanceInM <= 10 ? JSON.stringify([rssiEntry]) : JSON.stringify([]);
  const rssi_discard = deviceData.distanceInM > 10 ? JSON.stringify([rssiEntry]) : JSON.stringify([]);
  
  db.run(
    `INSERT INTO beacon_events (deviceId, beaconMac, name, rssi, rssi_discard, timestamp, type, uuid, major, minor, txPower, namespace, instance, distance, distanceInM, eventState, f_inicio, f_final, unit, manufacturerData, serviceData) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?, ?, ?)`,
    [
      deviceData.deviceId,
      deviceData.mac,
      deviceData.name,
      rssi, // Array JSON de RSSI para distancia <= 10m
      rssi_discard, // Array JSON de RSSI para distancia > 10m
      timestamp,
      deviceData.type,
      deviceData.uuid,
      deviceData.major,
      deviceData.minor,
      deviceData.txPower,
      deviceData.namespace,
      deviceData.instance,
      deviceData.distance,
      deviceData.distanceInM,
      timestamp, // f_inicio
      UNIT, // unit
      deviceData.manufacturerData,
      deviceData.serviceData
    ],
    err => {
      if (err) console.error('❌ Error guardando evento:', err);
      else {
        const rssiCount = deviceData.distanceInM <= 10 ? 1 : 0;
        const rssiDiscardCount = deviceData.distanceInM > 10 ? 1 : 0;
        console.log(`✅ Evento guardado para beacon ${deviceData.mac} | RSSI entries: ${rssiCount} | RSSI_discard entries: ${rssiDiscardCount}`);
      }
    }
  );
}

// Función para actualizar evento existente
function updateBeaconEvent(deviceData, eventId) {
  const timestamp = new Date().toISOString();
  console.log(`🔄 Actualizando evento ${eventId} para beacon: ${deviceData.mac}`);
  
  // Primero obtener arrays actuales para agregar nueva entrada
  db.get(
    `SELECT rssi, rssi_discard FROM beacon_events WHERE id = ?`,
    [eventId],
    (err, row) => {
      if (err) {
        console.error('❌ Error obteniendo arrays actuales:', err);
        return;
      }
      
      // Parsear arrays actuales (o crear vacíos si es NULL)
      let currentRssiArray = [];
      let currentRssiDiscardArray = [];
      
      try {
        currentRssiArray = row.rssi ? JSON.parse(row.rssi) : [];
        currentRssiDiscardArray = row.rssi_discard ? JSON.parse(row.rssi_discard) : [];
      } catch (parseErr) {
        console.error('❌ Error parseando arrays JSON:', parseErr);
        currentRssiArray = [];
        currentRssiDiscardArray = [];
      }
      
      // Crear nueva entrada
      const newRssiEntry = {
        rssi: deviceData.rssi || 0,
        datetime: Date.now(),
        distance: deviceData.distanceInM
      };
      
      // Agregar nueva entrada al array correspondiente según distancia
      if (deviceData.distanceInM <= 10) {
        currentRssiArray.push(newRssiEntry);
      } else {
        currentRssiDiscardArray.push(newRssiEntry);
      }
      
      // Actualizar evento con arrays actualizados
      db.run(
        `UPDATE beacon_events SET rssi = ?, rssi_discard = ?, timestamp = ?, distance = ?, distanceInM = ?, f_final = ?
         WHERE id = ?`,
        [
          JSON.stringify(currentRssiArray), 
          JSON.stringify(currentRssiDiscardArray), 
          timestamp, 
          deviceData.distance, 
          deviceData.distanceInM, 
          timestamp, 
          eventId
        ],
        err => {
          if (err) console.error('❌ Error actualizando evento:', err);
          else console.log(`✅ Evento ${eventId} actualizado | RSSI entries: ${currentRssiArray.length} | RSSI_discard entries: ${currentRssiDiscardArray.length}`);
        }
      );
    }
  );
}

// Función para cerrar evento
function closeBeaconEvent(eventId, deviceMac) {
  const timestamp = new Date().toISOString();
  console.log(`🔒 Cerrando evento ${eventId} para beacon: ${deviceMac}`);
  
  db.run(
    `UPDATE beacon_events SET eventState = 'closed', f_final = ? WHERE id = ?`,
    [timestamp, eventId],
    err => {
      if (err) console.error('❌ Error cerrando evento:', err);
      else console.log(`✅ Evento ${eventId} cerrado`);
    }
  );
}

// Función para obtener evento abierto por MAC
function getOpenEventByMac(mac, callback) {
  db.get(
    `SELECT * FROM beacon_events WHERE beaconMac = ? AND eventState = 'open' ORDER BY id DESC LIMIT 1`,
    [mac],
    callback
  );
}

// Parsear iBeacon (basado en tu código de React Native)
function parseIBeacon(manufacturerData) {
  if (!manufacturerData || manufacturerData.length < 25) return null;
  
  // Verificar si es Apple (0x004C) y tipo iBeacon (0x02, 0x15)
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
    
    // Convertir TxPower de unsigned byte a signed byte
    const txPowerRaw = manufacturerData[24];
    const txPower = txPowerRaw > 127 ? txPowerRaw - 256 : txPowerRaw;
    
    return { type: 'iBeacon', uuid, major, minor, txPower };
  }
  return null;
}

// Parsear Eddystone (basado en tu código de React Native)
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

// Procesar datos de beacon (similar a tu processDevice de React Native)
function processDevice(peripheral) {
  // Intentar parsear como iBeacon
  let beaconInfo = parseIBeacon(peripheral.advertisement.manufacturerData);
  
  // Si no es iBeacon, intentar como Eddystone
  if (!beaconInfo) {
    beaconInfo = parseEddystone(peripheral.advertisement.serviceData);
  }
  
  const txPower = beaconInfo?.txPower || -59;
  const distance = calculateDistance(peripheral.rssi || -100, txPower);
  const distanceInM = calculateDistanceInM(peripheral.rssi || -100, txPower);
  
  return {
    deviceId: peripheral.id,
    name: peripheral.advertisement.localName || null,
    mac: peripheral.address,
    rssi: peripheral.rssi,
    type: beaconInfo ? beaconInfo.type : 'BLE',
    uuid: beaconInfo?.uuid || null,
    major: beaconInfo?.major || null,
    minor: beaconInfo?.minor || null,
    txPower: beaconInfo?.txPower || null,
    namespace: beaconInfo?.namespace || null,
    instance: beaconInfo?.instance || null,
    distance: distance,
    distanceInM: distanceInM,
    manufacturerData: peripheral.advertisement.manufacturerData ? 
      peripheral.advertisement.manufacturerData.toString('hex') : null,
    serviceData: peripheral.advertisement.serviceData ? 
      JSON.stringify(peripheral.advertisement.serviceData) : null,
    isBeacon: !!beaconInfo
  };
}

// Escaneo BLE
noble.on('stateChange', state => {
  if (state === 'poweredOn') {
    noble.startScanning([], true); // true = permitir duplicados para actualizar RSSI
    console.log('Escaneo BLE iniciado...');
  } else {
    noble.stopScanning();
    console.log('Escaneo BLE detenido. Estado:', state);
  }
});

noble.on('discover', peripheral => {
  const deviceData = processDevice(peripheral);
  
  // Debug: Mostrar todos los dispositivos BLE detectados para diagnóstico
  console.log(`🔍 DEBUG - Dispositivo detectado:`);
  console.log(`   MAC: ${deviceData.mac}`);
  console.log(`   Nombre: ${deviceData.name || 'Sin nombre'}`);
  console.log(`   RSSI: ${deviceData.rssi}`);
  console.log(`   Es Beacon: ${deviceData.isBeacon}`);
  console.log(`   Tipo: ${deviceData.type}`);
  console.log(`   ManufacturerData: ${deviceData.manufacturerData || 'Ninguno'}`);
  console.log(`   ServiceData: ${deviceData.serviceData || 'Ninguno'}`);
  console.log(`   Cumple MAC filter: ${deviceData.mac.startsWith(TARGET_MAC_PREFIX)}`);
  console.log('   ---');
  
  // Solo procesar beacons con MAC específica (igual que tu condicional React Native)
  if (deviceData.isBeacon && deviceData.mac.startsWith(TARGET_MAC_PREFIX)) {
    // Guardar en cache para procesar cada segundo (no directamente en BD)
    detectedDevicesCache.set(deviceData.deviceId, deviceData);
    
    console.log(`🎯 Beacon detectado: ${deviceData.name} ${deviceData.type} | MAC=${deviceData.mac} | RSSI=${deviceData.rssi} | Distancia=${deviceData.distanceInM.toFixed(2)}m`);
    if (deviceData.type === 'iBeacon') {
      console.log(`  UUID=${deviceData.uuid} | Major=${deviceData.major} | Minor=${deviceData.minor}`);
    } else if (deviceData.type === 'Eddystone-UID') {
      console.log(`  Namespace=${deviceData.namespace} | Instance=${deviceData.instance}`);
    }
  } else if (deviceData.isBeacon) {
    // Beacon detectado pero MAC no coincide
    console.log(`⚪ Beacon ignorado (MAC no válida): MAC=${deviceData.mac} | Distancia=${deviceData.distanceInM.toFixed(2)}m`);
  } else {
    // Dispositivo BLE normal
    console.log(`📱 Dispositivo BLE: MAC=${deviceData.mac} | RSSI=${deviceData.rssi} | Nombre=${deviceData.name || 'Sin nombre'}`);
  }
});

// Función para procesar dispositivos acumulados (similar a tu lógica React Native)
function processDetectedDevices() {
  if (detectedDevicesCache.size === 0) return;

  console.log(`📊 Procesando ${detectedDevicesCache.size} dispositivos acumulados...`);
  
  for (const [deviceId, device] of detectedDevicesCache) {
    // Solo procesar beacons con MAC específica (igual que tu app React Native)
    if (device.isBeacon && device.mac.startsWith(TARGET_MAC_PREFIX)) {
      
      getOpenEventByMac(device.mac, (err, currentEvent) => {
        if (err) {
          console.error('❌ Error consultando evento:', err);
          return;
        }

        if (currentEvent) {
          // Hay un evento abierto, verificar si actualizar o cerrar
          const timeSinceLastUpdate = (Date.now() - new Date(currentEvent.f_final).getTime()) / 1000;
          
          if (device.distanceInM <= SCAN_RANGE || timeSinceLastUpdate < DEBOUNCE_TIME) {
            // Actualizar evento existente
            updateBeaconEvent(device, currentEvent.id);
          } else {
            // Cerrar evento por estar fuera de rango y tiempo
            closeBeaconEvent(currentEvent.id, device.mac);
          }
        } else if (device.distanceInM <= SCAN_RANGE) {
          // No hay evento abierto y está en rango, crear nuevo evento
          saveBeaconEvent(device);
        }
        // Si no hay evento abierto y está fuera de rango, no hacer nada
      });
    }
  }
  
  // Limpiar cache después de procesar
  detectedDevicesCache.clear();
  console.log('✅ Dispositivos procesados y cache limpiado');
}

// Procesar dispositivos cada segundo (como en tu app React Native)
setInterval(processDetectedDevices, 1000);

process.on('SIGINT', () => {
  console.log('\nFinalizando aplicación...');
  db.close((err) => {
    if (err) console.error('Error cerrando base de datos:', err);
    else console.log('Base de datos cerrada correctamente.');
  });
  noble.stopScanning();
  process.exit();
});
