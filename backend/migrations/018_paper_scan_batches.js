/**
 * 纸质作业扫描：批次与照片
 *
 * 背景：老师拍照登记纸质作业时，一次要处理几十张。原先的做法是
 *   「所有图片转 base64 塞进一个 POST」——30 张就有 9MB 请求体，必然超时；
 *   而且识别结果只存在后端内存里，关掉弹窗就再也回不来了。
 *
 * 改造后：
 *   - 照片逐张上传，先落盘，识别结果落库，关掉窗口/重启服务都不影响；
 *   - 老师可以「上传完先关掉，下次继续上传剩下的」，靠 batch 的 upload 状态衔接；
 *   - 识别按「组」调用 AI（同一份卷子的几张照片一起给模型，跨组不混），
 *     既有真实进度，也不会把一个人的卷子拆散。
 *
 * 表设计：
 *   paper_scan_batches  一次「扫描一份作业」= 一个批次，贯穿上传与识别
 *   paper_scan_images   批次里的每一张照片，记录归属分组与识别状态
 */

exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS paper_scan_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT,
      subject TEXT,

      -- 上传阶段：draft=草稿 uploading=上传中 uploaded=全部上传完成
      upload_status TEXT NOT NULL DEFAULT 'draft',
      -- 识别阶段：idle=未开始 running=识别中 done=完成 failed=失败
      scan_status TEXT NOT NULL DEFAULT 'idle',
      -- 老师设定的「每人几张」，用于分组与识别提示
      group_size INTEGER NOT NULL DEFAULT 1,

      total_images INTEGER NOT NULL DEFAULT 0,
      scanned_groups INTEGER NOT NULL DEFAULT 0,
      total_groups INTEGER NOT NULL DEFAULT 0,

      -- 识别结果：papers JSON（按学生分组，含 image_indexes / results / 待指派标记）
      result TEXT,
      error TEXT,
      model TEXT,

      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      scan_started_at DATETIME,
      scan_finished_at DATETIME,

      FOREIGN KEY (assignment_id) REFERENCES assignments(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_psb_assignment ON paper_scan_batches(assignment_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_psb_user ON paper_scan_batches(user_id)`);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS paper_scan_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      -- 组号：同一 group_no 的几张照片属于同一份卷子
      group_no INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL DEFAULT 0,

      file_path TEXT,
      file_name TEXT,
      file_size INTEGER,
      mime_type TEXT,

      -- pending=待识别 done=已识别 failed=该张失败 skipped=被剔除
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      -- 所属学生 id：分组识别命中后回填；null 表示待老师指派
      student_id INTEGER,
      -- AI 读到的卷面原始姓名
      raw_name TEXT,

      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),

      FOREIGN KEY (batch_id) REFERENCES paper_scan_batches(id) ON DELETE CASCADE
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_psi_batch ON paper_scan_images(batch_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_psi_group ON paper_scan_images(batch_id, group_no)`);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_psi_group`);
  await knex.raw(`DROP INDEX IF EXISTS idx_psi_batch`);
  await knex.raw(`DROP TABLE IF EXISTS paper_scan_images`);
  await knex.raw(`DROP INDEX IF EXISTS idx_psb_user`);
  await knex.raw(`DROP INDEX IF EXISTS idx_psb_assignment`);
  await knex.raw(`DROP TABLE IF EXISTS paper_scan_batches`);
};