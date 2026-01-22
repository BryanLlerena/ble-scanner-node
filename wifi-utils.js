const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Módulo de utilidades WiFi personalizado
 * Reemplaza a node-wifi para compatibilidad con sistemas sin NetworkManager
 * Usa comandos nativos: iwgetid, iw
 */

// Ejecuta un comando y devuelve stdout limpio o null si falla
async function runCommand(cmd) {
  try {
    const { stdout } = await execPromise(cmd);
    return stdout ? stdout.trim() : null;
  } catch (error) {
    return null;
  }
}

/**
 * Obtiene información básica de la conexión actual (SSID, BSSID)
 * Compatible con la firma esperada en sync.js y sync-mqtt.js
 */
async function getWifiInfo() {
  try {
    // Intentar obtener SSID
    // iwgetid -r imprime solo el SSID
    let ssid = await runCommand('iwgetid -r');
    
    // Intentar obtener BSSID (MAC del AP)
    // iwgetid -r -a imprime solo el BSSID
    let bssid = await runCommand('iwgetid -r -a');

    // Fallback: usar 'iw dev' si iwgetid falla o no está instalado
    if (!ssid || !bssid) {
      const iwOutput = await runCommand('iw dev wlan0 link');
      if (iwOutput) {
        if (!ssid) {
          const ssidMatch = iwOutput.match(/SSID: (.+)/);
          if (ssidMatch) ssid = ssidMatch[1];
        }
        if (!bssid) {
          const bssidMatch = iwOutput.match(/Connected to ([0-9a-f:]{17})/i);
          if (bssidMatch) bssid = bssidMatch[1];
        }
      }
    }

    return { 
      ssid: ssid || null, 
      bssid: bssid || null 
    };
  } catch (error) {
    console.error('Error obteniendo info WiFi:', error);
    return { ssid: null, bssid: null };
  }
}

/**
 * Obtiene estado completo para wifi-status.js
 */
async function getWifiStatus() {
  try {
    const { ssid, bssid } = await getWifiInfo();
    const status = (ssid && bssid) ? 'connected' : 'disconnected';

    return {
      timestamp: new Date().toISOString(),
      ssid,
      bssid,
      status
    };
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      ssid: null,
      bssid: null,
      status: 'disconnected'
    };
  }
}

module.exports = {
  getWifiInfo,
  getWifiStatus
};
