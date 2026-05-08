const db = require('better-sqlite3')('./data/database.sqlite');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables (' + tables.length + '):');
tables.forEach(t => console.log('  ' + t.name));

const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all();
console.log('Views (' + views.length + '):');
views.forEach(v => console.log('  ' + v.name));

const users = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
console.log('Users:', users.cnt);

const pets = db.prepare('SELECT COUNT(*) as cnt FROM pets').get();
console.log('Pets:', pets.cnt);

const migrations = db.prepare('SELECT * FROM knex_migrations').all();
console.log('Migrations:', migrations.length);

db.close();