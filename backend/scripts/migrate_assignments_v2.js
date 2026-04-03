const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
const dbPath = path.join(dataDir, 'database.sqlite');

if (!fs.existsSync(dbPath)) {
  console.log('数据库不存在，请先运行 init_db.js');
  process.exit(1);
}

const db = new Database(dbPath);
console.log('=== 作业系统升级 - 数据库迁移 ===\n');

try {
  console.log('1. 检查并创建 question_bank 表...');
  const checkQB = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='question_bank'").get();
  if (!checkQB) {
    db.exec(`
      CREATE TABLE question_bank (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        topic TEXT,
        difficulty TEXT DEFAULT 'medium',
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        options TEXT,
        answer TEXT NOT NULL,
        explanation TEXT,
        analysis TEXT,
        hint TEXT,
        variant_group_id INTEGER,
        variant_index INTEGER DEFAULT 0,
        source TEXT DEFAULT 'ai',
        usage_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER
      )
    `);
    db.exec(`CREATE INDEX idx_qb_variant_group ON question_bank(variant_group_id)`);
    db.exec(`CREATE INDEX idx_qb_subject ON question_bank(subject)`);
    console.log('   ✓ question_bank 表创建成功');
  } else {
    console.log('   - question_bank 表已存在，跳过');
  }

  console.log('\n2. 检查并创建 assignment_questions 表...');
  const checkAQ = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assignment_questions'").get();
  if (!checkAQ) {
    db.exec(`
      CREATE TABLE assignment_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id INTEGER NOT NULL,
        question_bank_id INTEGER NOT NULL,
        sort_order INTEGER DEFAULT 0,
        score_weight REAL DEFAULT 1.0,
        FOREIGN KEY (assignment_id) REFERENCES assignments(id),
        FOREIGN KEY (question_bank_id) REFERENCES question_bank(id)
      )
    `);
    db.exec(`CREATE INDEX idx_aq_assignment ON assignment_questions(assignment_id)`);
    db.exec(`CREATE INDEX idx_aq_question ON assignment_questions(question_bank_id)`);
    console.log('   ✓ assignment_questions 表创建成功');
  } else {
    console.log('   - assignment_questions 表已存在，跳过');
  }

  console.log('\n3. 检查并创建 question_answers 表...');
  const checkQA = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='question_answers'").get();
  if (!checkQA) {
    db.exec(`
      CREATE TABLE question_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL,
        question_bank_id INTEGER NOT NULL,
        attempt_number INTEGER DEFAULT 1,
        student_answer TEXT,
        is_correct INTEGER DEFAULT 0,
        score REAL,
        max_score REAL,
        feedback TEXT,
        image_url TEXT,
        reviewed_at DATETIME,
        answered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (submission_id) REFERENCES submissions(id),
        FOREIGN KEY (question_bank_id) REFERENCES question_bank(id)
      )
    `);
    db.exec(`CREATE INDEX idx_qa_submission ON question_answers(submission_id)`);
    db.exec(`CREATE INDEX idx_qa_question ON question_answers(question_bank_id)`);
    console.log('   ✓ question_answers 表创建成功');
  } else {
    console.log('   - question_answers 表已存在，跳过');
  }

  console.log('\n4. 检查并创建 upload_files 表...');
  const checkUF = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='upload_files'").get();
  if (!checkUF) {
    db.exec(`
      CREATE TABLE upload_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        upload_type TEXT DEFAULT 'assignment',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ upload_files 表创建成功');
  } else {
    console.log('   - upload_files 表已存在，跳过');
  }

  console.log('\n4.5 为 wrong_questions 表添加 wrong_count 字段...');
  try {
    db.exec(`ALTER TABLE wrong_questions ADD COLUMN wrong_count INTEGER DEFAULT 1`);
    console.log('   ✓ wrong_questions.wrong_count 字段添加成功');
  } catch (e) {
    if (e.message.includes('duplicate column')) {
      console.log('   - wrong_questions.wrong_count 字段已存在，跳过');
    } else {
      throw e;
    }
  }

  console.log('\n5. 为 assignments 表添加 class_id 字段...');
  try {
    db.exec(`ALTER TABLE assignments ADD COLUMN class_id INTEGER`);
    console.log('   ✓ assignments.class_id 字段添加成功');
  } catch (e) {
    if (e.message.includes('duplicate column')) {
      console.log('   - assignments.class_id 字段已存在，跳过');
    } else {
      throw e;
    }
  }

  console.log('\n6. 为 submissions 表添加新字段...');
  const newFields = [
    { name: 'total_score', sql: 'REAL' },
    { name: 'total_max_score', sql: 'REAL' },
    { name: 'review_status', sql: "TEXT DEFAULT 'pending'" },
    { name: 'attempt_count', sql: 'INTEGER DEFAULT 1' },
  ];
  for (const f of newFields) {
    try {
      db.exec(`ALTER TABLE submissions ADD COLUMN ${f.name} ${f.sql}`);
      console.log(`   ✓ submissions.${f.name} 字段添加成功`);
    } catch (e) {
      if (e.message.includes('duplicate column')) {
        console.log(`   - submissions.${f.name} 字段已存在，跳过`);
      } else {
        throw e;
      }
    }
  }

  console.log('\n7. 确保 uploads 目录存在...');
  const uploadsDir = path.join(__dirname, '../../backend/uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('   ✓ uploads 目录创建成功');
  } else {
    console.log('   - uploads 目录已存在');
  }

  console.log('\n✅ 数据库迁移完成！');
  console.log('新增表: question_bank, assignment_questions, question_answers, upload_files');
  console.log('修改表: assignments (+class_id), submissions (+4字段)');

} catch (error) {
  console.error('❌ 迁移失败:', error.message);
  process.exit(1);
}

db.close();
