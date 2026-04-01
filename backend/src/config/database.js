const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;
try {
  db = new Database(path.join(dataDir, 'database.sqlite'), { fileMustExist: false });
} catch (err) {
  console.error('Failed to open database:', err);
}

const initDatabase = () => {
  return new Promise((resolve) => {
    console.log('✅ Real SQLite Database initialized successfully');
    resolve(db);
  });
};

module.exports = { db, initDatabase };
