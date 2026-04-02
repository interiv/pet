const {db} = require('./src/config/database');
const bcrypt = require('bcryptjs');

const hash = bcrypt.hashSync('111111', 10);
const result = db.prepare("UPDATE users SET password_hash = ?").run(hash);
console.log(`Updated ${result.changes} users with password '111111'`);