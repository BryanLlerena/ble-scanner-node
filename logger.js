// Sistema de logging con niveles para BLE Scanner
require('dotenv').config();

// Niveles de logging
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// Configuración desde variables de entorno
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.info;
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

// Colores para diferentes niveles (opcional)
const COLORS = {
  debug: '\x1b[36m',   // Cyan
  info: '\x1b[32m',    // Green  
  warn: '\x1b[33m',    // Yellow
  error: '\x1b[31m',   // Red
  reset: '\x1b[0m'     // Reset
};

// Función principal de logging
function log(level, message, data = null) {
  const levelValue = LOG_LEVELS[level];
  
  // Solo mostrar si el nivel es suficientemente alto
  if (levelValue >= CURRENT_LOG_LEVEL) {
    const timestamp = new Date().toISOString();
    const color = COLORS[level] || '';
    const reset = COLORS.reset;
    
    let logMessage = `${color}[${timestamp}] [${level.toUpperCase()}]${reset} ${message}`;
    
    // Agregar datos adicionales si se proporcionan
    if (data) {
      logMessage += ` ${JSON.stringify(data)}`;
    }
    
    console.log(logMessage);
  }
}

// Funciones de conveniencia
const logger = {
  debug: (message, data) => log('debug', message, data),
  info: (message, data) => log('info', message, data),
  warn: (message, data) => log('warn', message, data),
  error: (message, data) => log('error', message, data),
  
  // Funciones especiales para desarrollo
  dev: (message, data) => {
    if (IS_DEVELOPMENT) {
      log('debug', `[DEV] ${message}`, data);
    }
  },
  
  // Solo para eventos críticos (siempre se muestran)
  critical: (message, data) => {
    const timestamp = new Date().toISOString();
    console.error(`🚨 [${timestamp}] [CRITICAL] ${message}`, data || '');
  }
};

// Función para cambiar el nivel de log en runtime (útil para debug)
logger.setLevel = (newLevel) => {
  if (LOG_LEVELS[newLevel] !== undefined) {
    process.env.LOG_LEVEL = newLevel;
    logger.info(`Nivel de logging cambiado a: ${newLevel}`);
  } else {
    logger.error(`Nivel de logging inválido: ${newLevel}. Usar: debug, info, warn, error`);
  }
};

// Información de configuración inicial
logger.info(`🔧 Sistema de logging iniciado`);
logger.info(`   Nivel actual: ${process.env.LOG_LEVEL || 'info'}`);
logger.info(`   Entorno: ${process.env.NODE_ENV || 'production'}`);

module.exports = logger;
