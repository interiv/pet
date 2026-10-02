/**
 * 教师端学情报告存档
 *
 * 为什么不用现有的 ai_reports：
 *  1. ai_reports 是 UNIQUE(user_id, report_type) 覆盖写，只能保留最后一次，没有历史
 *  2. 缺少 class_id / subject / 统计区间 / 生成者等字段，无法支撑「按学科、按时段出报告」
 *  3. user_id 语义混乱（既是分析对象也是触发者）
 *
 * 这里新建表并保留全部历史版本，支持「本期 vs 上期」对比。
 */
exports.up = async function (knex) {
  await knex.schema.createTable('learning_reports', (table) => {
    table.increments('id').primary();
    table.string('report_type', 20).notNullable();          // class 班级报告 / student 个体报告
    table.integer('class_id').nullable();
    table.integer('target_student_id').nullable();          // 个体报告的被分析学生（班级报告为空）
    table.string('subject', 40).nullable();                 // null = 全部学科
    table.date('period_start').nullable();
    table.date('period_end').nullable();
    table.text('content').notNullable();                    // AI 返回的 JSON
    table.text('context').nullable();                       // 生成时的数据快照
    table.string('model', 80).nullable();
    table.integer('generated_by').nullable();              // 触发的教师
    table.string('generated_by_name', 50).nullable();
    table.text('summary', 500).nullable();                  // 报告摘要，便于列表展示
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.foreign('class_id').references('classes.id').onDelete('SET NULL');
    table.foreign('target_student_id').references('users.id').onDelete('SET NULL');
    table.foreign('generated_by').references('users.id').onDelete('SET NULL');
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_lr_class ON learning_reports (class_id, report_type, subject, created_at DESC)');
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_lr_class');
  await knex.schema.dropTableIfExists('learning_reports');
};
