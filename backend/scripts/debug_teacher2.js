const Database = require('better-sqlite3');
const db = new Database('./data/database.sqlite');

const userId = 3;
const classIdStr = '2';
const classIdNum = 2;

const resultStr = db.prepare(
  `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
).get(userId, classIdStr);
console.log('String classId result:', resultStr);

const resultNum = db.prepare(
  `SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? AND role = 'head_teacher'`
).get(userId, classIdNum);
console.log('Number classId result:', resultNum);

db.close();
