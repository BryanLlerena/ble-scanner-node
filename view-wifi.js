const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('wifi_status.db');

db.all('SELECT * FROM wifi_status ORDER BY timestamp DESC LIMIT 100', (err, rows) => {
  if (err) {
    console.error('Error consultando la base de datos:', err);
  } else {
    console.table(rows);
  }
  db.close();
});
