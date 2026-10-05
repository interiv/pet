/**
 * 纸质扫描批次绑定到具体学生
 *
 * 背景：单人登记是「一次处理一个学生」，老师会在多个学生之间来回切换。
 * 原先批次只记录「属于哪份作业」，不记录「这份是给谁扫的」，
 * 于是切学生时前端复用了同一个批次——A 学生的 3 张和 B 学生的 2 张
 * 被合进同一份卷子送去AI 识别，两人的卷面混在一起。
 *
 * 加了 student_id 之后：
 *   - 每个学生一个独立批次，互不干扰
 *   - 关掉弹窗再打开，能按学生恢复上次的照片与识别进度
 *   - 左侧学生列表可以显示「谁传了几张、谁判完了」
 *
 * 批量扫描不使用这个字段（留空）：批量模式下 AI 靠卷面姓名自动归属，
 * 一个批次装着全班，是有意为之。
 *
 * 说明：这里不查 PRAGMA 判断列是否存在——不同驱动返回的格式不一样，
 * 统一用 try/catch 捕获「列已存在」的错误，效果相同且不依赖驱动行为。
 */

const ADD_COLUMN = (table, column, type) => `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`;

exports.up = async function (knex) {
  // 用 ALTER ADD COLUMN 而非重建表：已有批次数据要保留。
  // 重复执行会报「duplicate column name」，那说明列已存在，忽略即可。
  const attempt = async (sql) => {
    try {
      await knex.raw(sql);
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (!/duplicate column name|already exists/i.test(msg)) throw e;
    }
  };

  // 这份批次是为哪个学生扫的（单人登记用；批量扫描留空）
  await attempt(ADD_COLUMN('paper_scan_batches', 'student_id', 'INTEGER'));
  // 登记时间：区分「已识别」与「已识别且已登记成绩」
  await attempt(ADD_COLUMN('paper_scan_batches', 'registered_at', 'DATETIME'));

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_psb_student ON paper_scan_batches(assignment_id, student_id)');
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_psb_student');
};
