const noble = require('@abandonware/noble');

console.log("Probando Noble...");

noble.on('stateChange', (state) => {
  console.log(`Estado del adaptador: ${state}`);
  if (state === 'poweredOn') {
    console.log("✅ Noble puede usar el Bluetooth. Iniciando escaneo...");
    noble.startScanning([], true);
  } else {
    console.log("❌ Noble no puede encender el Bluetooth. Estado:", state);
  }
});

noble.on('discover', (peripheral) => {
  console.log(`🎯 Encontrado: ${peripheral.address} (${peripheral.advertisement.localName || 'Sin nombre'})`);
});

// Detener después de 10 segundos
setTimeout(() => {
  console.log("Terminando prueba...");
  process.exit(0);
}, 10000);
