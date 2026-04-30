const db = require('better-sqlite3')('./data/database.sqlite');

const assignments = db.prepare("SELECT * FROM assignments LIMIT 5").all();
console.log('assignments:', JSON.stringify(assignments, null, 2));

const qb = db.prepare("SELECT id, subject, knowledge_point, topic, type, difficulty FROM question_bank LIMIT 10").all();
console.log('question_bank:', JSON.stringify(qb, null, 2));

const settings = db.prepare("SELECT * FROM settings WHERE key LIKE 'ai_%'").all();
console.log('AI settings:', settings);

const wrongQ = db.prepare("SELECT * FROM wrong_questions LIMIT 5").all();
console.log('wrong_questions:', JSON.stringify(wrongQ, null, 2));

const qa = db.prepare("SELECT * FROM question_answers LIMIT 5").all();
console.log('question_answers:', JSON.stringify(qa, null, 2));

const dt = db.prepare("SELECT * FROM daily_tasks LIMIT 5").all();
console.log('daily_tasks:', JSON.stringify(dt, null, 2));

const kps = db.prepare("SELECT * FROM knowledge_point_stats LIMIT 5").all();
console.log('knowledge_point_stats:', JSON.stringify(kps, null, 2));

db.close();
