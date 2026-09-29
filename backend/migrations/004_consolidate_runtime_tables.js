/**
 * 收编「运行时建表」到迁移体系
 *
 * 背景：原先有三处在模块加载时自行建表/加列——
 *   - cards.js       ensureTables()          建 cards / card_batches / card_redemption_logs
 *                                            classroom_quizzes / classroom_quiz_questions
 *                                            classroom_quiz_rewards / classroom_quiz_answers
 *   - assignments.js ensureTokenUsageTable() 建 token_usage
 *   - pets.js        ALTER TABLE pets        加 feed_count
 *
 * 问题：路由模块在 server.js 里是先 require、后跑 knex 迁移的，
 * 等于建表走双轨，迁移回滚会失败，且表结构散落在代码里难以追踪。
 *
 * 说明：cards / card_batches / card_redemption_logs / classroom_quizzes /
 * classroom_quiz_questions / classroom_quiz_rewards / settings 以及 pets.feed_count
 * 已由 001_initial_schema 创建，本迁移只补齐缺失的两张表，并对历史库兜底补列。
 */

exports.up = async function (knex) {
  // token_usage：AI 用量统计（原由 assignments.js 运行时创建）
  if (!(await knex.schema.hasTable('token_usage'))) {
    await knex.raw(`
      CREATE TABLE token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        model TEXT DEFAULT '',
        subject TEXT DEFAULT '',
        topic TEXT DEFAULT '',
        question_type TEXT DEFAULT '',
        question_count INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_token_usage_user_date ON token_usage(user_id, date)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(date)');
  }

  // classroom_quiz_answers：课堂答题记录（原由 cards.js 运行时创建，001 中遗漏）
  if (!(await knex.schema.hasTable('classroom_quiz_answers'))) {
    await knex.raw(`
      CREATE TABLE classroom_quiz_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quiz_id INTEGER NOT NULL,
        question_id INTEGER,
        student_id INTEGER NOT NULL,
        answer_text TEXT,
        judged_by_ai INTEGER DEFAULT 0,
        is_correct INTEGER,
        score INTEGER DEFAULT 0,
        coin_rewarded INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (quiz_id) REFERENCES classroom_quizzes(id),
        FOREIGN KEY (question_id) REFERENCES classroom_quiz_questions(id),
        FOREIGN KEY (student_id) REFERENCES users(id)
      )
    `);
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_classroom_quiz_answers_quiz ON classroom_quiz_answers(quiz_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_classroom_quiz_answers_student ON classroom_quiz_answers(student_id)');
  }

  // pets.feed_count：001 已带该列，这里仅为早期历史库兜底
  try {
    await knex.raw('ALTER TABLE pets ADD COLUMN feed_count INTEGER DEFAULT 0');
  } catch (e) {
    // 列已存在，忽略
  }
};

exports.down = async function (knex) {
  // 只回滚本次新增的两张表（SQLite 老版本不支持 DROP COLUMN，feed_count 保留）
  await knex.schema.dropTableIfExists('classroom_quiz_answers');
  await knex.schema.dropTableIfExists('token_usage');
};
