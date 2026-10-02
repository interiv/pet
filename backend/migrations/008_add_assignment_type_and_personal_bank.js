/**
 * 预习/作业/复习 作业类型 + 学生个人题库
 *
 * 背景：
 * 1. 住校生无平板/手机，预习靠老师打印纸质题、做完拍照上传。
 *    预习题与课后作业混在同一张 assignments 表里，学情统计无法区分，
 *    因此新增 assignment_type（preview 预习 / homework 作业 / review 复习）。
 * 2. 错题本只保存做错的题，学生缺少"做过的全部题目"的沉淀。
 *    新增 personal_question_bank：每次提交（线上或纸质登记）逐题 upsert，
 *    保留首次/最近一次作答、作答次数、正确次数，供个人库回看与复习。
 */

const PERSONAL_BANK_TABLE = `
  CREATE TABLE personal_question_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    assignment_id INTEGER,
    assignment_type TEXT,
    subject TEXT,
    knowledge_point TEXT,
    first_answer TEXT,
    last_answer TEXT,
    is_correct INTEGER DEFAULT 0,
    attempt_count INTEGER DEFAULT 1,
    correct_count INTEGER DEFAULT 0,
    source TEXT DEFAULT 'online',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, question_id)
  )
`;

exports.up = async function (knex) {
  const hasCol = await knex.schema.hasColumn('assignments', 'assignment_type');
  if (!hasCol) {
    await knex.raw("ALTER TABLE assignments ADD COLUMN assignment_type TEXT NOT NULL DEFAULT 'homework'");
  }
  // 存量数据：预习/复习无历史标记，统一归为 homework，保证统计口径完整
  await knex.raw("UPDATE assignments SET assignment_type = 'homework' WHERE assignment_type IS NULL OR assignment_type = ''");

  const hasTable = await knex.schema.hasTable('personal_question_bank');
  if (!hasTable) {
    await knex.raw(PERSONAL_BANK_TABLE);
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pqb_user ON personal_question_bank(user_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_pqb_user_subject ON personal_question_bank(user_id, subject)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_assignments_type ON assignments(assignment_type)');
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_pqb_user');
  await knex.raw('DROP INDEX IF EXISTS idx_pqb_user_subject');
  await knex.raw('DROP INDEX IF EXISTS idx_assignments_type');
  await knex.schema.dropTableIfExists('personal_question_bank');
  // SQLite 老版本不支持 DROP COLUMN，仅把值归位为默认值
  await knex.raw("UPDATE assignments SET assignment_type = 'homework'");
};
