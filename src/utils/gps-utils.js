// Utilidades para cálculos de GPS
const logger = require('./logger');

/**
 * Calcula la distancia entre dos coordenadas en metros usando la fórmula de Haversine
 * @param {number} lat1 Latitud 1
 * @param {number} lon1 Longitud 1
 * @param {number} lat2 Latitud 2
 * @param {number} lon2 Longitud 2
 * @returns {number} Distancia en metros
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio de la Tierra en metros
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Metros
}

/**
 * Calcula la velocidad entre dos puntos GPS
 * @param {Object} prevPoint Objeto con {latitude, longitude, timestamp}
 * @param {Object} currentPoint Objeto con {latitude, longitude, timestamp}
 * @returns {number} Velocidad en km/h
 */
function calculateSpeedKmH(prevPoint, currentPoint) {
    if (!prevPoint || !currentPoint) return 0;
    if (!prevPoint.latitude || !prevPoint.longitude || !currentPoint.latitude || !currentPoint.longitude) return 0;

    const timeA = new Date(prevPoint.timestamp).getTime();
    const timeB = new Date(currentPoint.timestamp).getTime();

    // Tiempo transcurrido en segundos
    const timeDiffSec = Math.abs((timeB - timeA) / 1000);

    if (timeDiffSec <= 0) return 0; // Evitar división por cero

    // Distancia en metros
    const distanceMeters = calculateHaversineDistance(
        prevPoint.latitude, prevPoint.longitude,
        currentPoint.latitude, currentPoint.longitude
    );

    // m/s a km/h
    const speed = (distanceMeters / timeDiffSec) * 3.6;

    // Filtro de ruido: Si la velocidad es menor a 2 km/h (velocidad de caminar muy lento o detenido), 
    // probablemente el GPS esté quieto y sea solo deriva de señal (wandering).
    if (speed < 2) {
        return 0;
    }

    // Lógica para descartar "saltos" irreales (ej. > 150 km/h en un vehículo minero)
    if (speed > 150) {
        // logger.warn(`Salto GPS irreal detectado: ${speed.toFixed(2)} km/h. Distancia: ${distanceMeters}m en ${timeDiffSec}s`);
        return prevPoint.speed || 0; // Devuelve la velocidad anterior o cero si no había
    }

    return Number(speed.toFixed(2));
}

module.exports = {
    calculateHaversineDistance,
    calculateSpeedKmH
};
