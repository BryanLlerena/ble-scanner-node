// BLE Scanner para Raspberry Pi usando noble y SQLite
const noble = require('noble');
const sqlite3 = require('sqlite3').verbose();

// Inicializar base de datos SQLite
const db = new sqlite3.Database('beacons.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS beacons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deviceId TEXT,
    name TEXT,
    mac TEXT,
    rssi INTEGER,
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
    manufacturerData TEXT,
    serviceData TEXT
  )`);
});

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

// Función para guardar beacon
function saveBeacon(deviceData) {
  const timestamp = new Date().toISOString();
  db.run(
    `INSERT INTO beacons (deviceId, name, mac, rssi, timestamp, type, uuid, major, minor, txPower, namespace, instance, distance, distanceInM, manufacturerData, serviceData) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deviceData.deviceId,
      deviceData.name,
      deviceData.mac,
      deviceData.rssi,
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
      deviceData.manufacturerData,
      deviceData.serviceData
    ],
    err => {
      if (err) console.error('Error guardando beacon:', err);
    }
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
  saveBeacon(deviceData);
  
  if (deviceData.isBeacon) {
    console.log(`Beacon detectado: ${deviceData.type} | MAC=${deviceData.mac} | RSSI=${deviceData.rssi} | Distancia=${deviceData.distanceInM.toFixed(2)}m`);
    if (deviceData.type === 'iBeacon') {
      console.log(`  UUID=${deviceData.uuid} | Major=${deviceData.major} | Minor=${deviceData.minor}`);
    } else if (deviceData.type === 'Eddystone-UID') {
      console.log(`  Namespace=${deviceData.namespace} | Instance=${deviceData.instance}`);
    }
  } else {
    console.log(`Dispositivo BLE: MAC=${deviceData.mac} | RSSI=${deviceData.rssi} | Nombre=${deviceData.name || 'Sin nombre'}`);
  }
});

process.on('SIGINT', () => {
  console.log('\nFinalizando aplicación...');
  db.close((err) => {
    if (err) console.error('Error cerrando base de datos:', err);
    else console.log('Base de datos cerrada correctamente.');
  });
  noble.stopScanning();
  process.exit();
});
