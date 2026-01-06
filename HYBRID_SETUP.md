# Sistema Híbrido BLE Scanner

## 🎯 Configuración completada: Qt BLE + Node.js Services

### **División de responsabilidades:**

| Componente | Responsabilidad | Estado |
|------------|----------------|---------|
| **Qt BLE Scanner** | 📡 Scanning BLE nativo | ✅ Estable |
| **Node.js Hybrid** | ⏱️ Timeouts, 📊 Stats | ✅ Sin bluetoothctl |  
| **Node.js Web** | 🌐 Interface web | ✅ Puerto 3000 |
| **Node.js MQTT** | 📤 Sincronización | ✅ Opcional |
| **SQLite DB** | 💾 beacons.db | ✅ Compartida |

---

## 🚀 **Cómo usar el sistema híbrido:**

### **1. Iniciar sistema completo:**
```bash
chmod +x start_hybrid.sh stop_hybrid.sh
./start_hybrid.sh
```

### **2. Verificar que funciona:**
- **Qt Scanner:** Ventana gráfica con dispositivos BLE
- **Web Interface:** http://localhost:3000
- **Base de datos:** `beacons.db` compartida

### **3. Detener sistema:**
```bash
./stop_hybrid.sh
```

---

## 📁 **Archivos modificados/creados:**

### **Qt BLE Scanner (carpeta bluetooth/):**
- `ble_gap.h/cpp` → Usa misma DB que Node.js
- `BLE_Scanner.pro` → Compilación optimizada
- UI simplificada → Solo scanning + logs

### **Node.js Híbrido:**
- `index_hybrid.js` → SIN bluetoothctl, solo servicios
- `start_hybrid.sh` → Script coordinador
- `package_hybrid.json` → Configuración híbrida

---

## 🔧 **Configuración actual:**

### **Qt Scanner:**
- **Base de datos:** `./beacons.db` (misma que Node.js)
- **Prefijo objetivo:** `BC:57:29` 
- **Rango escaneo:** 80 metros
- **UI:** Dispositivos descubiertos + logs Node.js

### **Node.js Services:**
- **Timeouts:** Cierra eventos expirados cada 30s
- **Estadísticas:** Muestra stats cada 5min
- **Monitor Qt:** Verifica actividad cada 2min
- **Web viewer:** Puerto 3000 (tu interfaz actual)

---

## ✅ **Ventajas del sistema híbrido:**

| Problema anterior | Solución híbrida |
|------------------|------------------|
| ❌ bluetoothctl se congela | ✅ Qt BLE nativo |
| ❌ Reinicios constantes | ✅ Sin subprocess |
| ❌ Alto CPU | ✅ Qt eficiente |
| ❌ Sin UI gráfica | ✅ Qt + Web |
| ❌ Código complejo | ✅ Responsabilidades separadas |

---

## 🎯 **Próximos pasos:**

1. **Probar:** `./start_hybrid.sh`
2. **Verificar:** Dispositivos en Qt + Web http://localhost:3000
3. **Monitorear:** Logs en ambas ventanas
4. **Decidir:** Si funciona bien, eliminar `index.js` original

**¿Todo listo para probar el sistema híbrido?** 🚀