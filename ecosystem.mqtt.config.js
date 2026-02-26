{
  apps: [
    {
      name: 'ble-scanner',
      script: 'src/beacons/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
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
    }
  ]
}