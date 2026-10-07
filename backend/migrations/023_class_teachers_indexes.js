/**
 * 补齐 class_teachers 索引
 *
 * 背景：
 * class_teachers 此前除 UNIQUE(class_id, teacher_id) 产生的隐式索引外没有任何索引。
 * 班主任支持多对多后，本文件（022）对班主任关系的读写的使用频率明显上升，补齐索引。
 *
 * 索引取舍：
 * 1) idx_class_teachers_teacher (teacher_id, class_id, role)
 *    class_id 方向已被 UNIQUE(class_id, teacher_id) 的前缀覆盖，缺的是 teacher_id 方向。
 *    这是登录热路径：POST /auth/login 与 GET /auth/me 都要执行
 *    `WHERE ct.teacher_id = ?`（登录、刷新页面、任何一次鉴权后的用户信息拉取都会触发），
 *    此外 classroomQuiz.listTeacherClasses、skills.describeTeachingClasses、
 *    checkDataPermission、syncTeacherClasses 也都走这一方向。
 *    把 class_id、role 放进复合索引，可让「取某教师在某班的身份」这类高频点查
 *    （posts/pets/paperScan/learning-reports/knowledge-points 的权限校验）
 *    也走同一棵索引，避免退化成全表扫描。
 *
 * 2) idx_class_teachers_class (class_id, role, created_at)
 *    class_id 方向虽然有隐式索引，但 role 只是过滤条件、created_at 需要额外排序。
 *    补上后，「按设置时间取该班班主任」类查询可由索引直接有序输出，
 *    不必再 filesort。created_at 精度只到秒，同一秒设置的班主任由 id 兜底排序。
 *
 * 说明：class_teachers 体量很小（教师数 × 任教班级数），
 * 建索引是毫秒级操作，无需担心迁移耗时。
 * 全部使用 IF NOT EXISTS，重复执行安全。
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_class_teachers_teacher
    ON class_teachers (teacher_id, class_id, role)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_class_teachers_class
    ON class_teachers (class_id, role, created_at)
  `);
};

exports.down = async function () {
  // 不回滚：索引只影响查询性能，不影响数据正确性；回滚会让登录等热路径重新退化为全表扫描
};