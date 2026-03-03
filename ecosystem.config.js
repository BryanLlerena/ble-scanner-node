module.exports = {
  apps: [
    {
      name: 'ble-scanner',
      script: 'src/beacons/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        NOBLE_MULTI_ROLE: '1'
      },
      error_file: './logs/ble-scanner-err.log',
      out_file: './logs/ble-scanner-out.log',
      log_file: './logs/ble-scanner-combined.log',
      time: true
    },
    {
      name: 'sync-processor',
      script: 'src/sync/sync-processor.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/sync-processor-err.log',
      out_file: './logs/sync-processor-out.log',
      log_file: './logs/sync-processor-combined.log',
      time: true
    },
    {
      name: 'mqtt-service',
      script: 'src/sync/sync-mqtt.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/mqtt-service-err.log',
      out_file: './logs/mqtt-service-out.log',
      log_file: './logs/mqtt-service-combined.log',
      time: true
    },
    {
      name: 'wifi-status',
      script: 'src/wifi/wifi-status.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        WIFI_PORT: 3035
      },
      error_file: './logs/wifi-status-err.log',
      out_file: './logs/wifi-status-out.log',
      log_file: './logs/wifi-status-combined.log',
      time: true
    },
    {
      name: 'ble-server',
      script: 'src/diagnostics/ble-server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        BLENO_MULTI_ROLE: '1',
        NOBLE_MULTI_ROLE: '1'
      },
      error_file: './logs/ble-server-err.log',
      out_file: './logs/ble-server-out.log',
      log_file: './logs/ble-server-combined.log',
      time: true
    }
  ]
};