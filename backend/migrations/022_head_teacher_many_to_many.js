/**
 * 班主任改为多对多（一个班可有多位班主任，一位教师可担任多个班的班主任）
 *
 * 背景：
 * - 权威关系是 class_teachers.role = 'head_teacher'，该表结构本就支持多行。
 * - classes.head_teacher_id 是历史遗留的单值冗余字段，现语义调整为「主班主任」，
 *   指向该班最早设置的那位班主任，供班级公开页、统计报表等只展示单人的旧逻辑使用。
 *
 * 本迁移做两件事（都幂等）：
 *  1. 反向补全：早期版本只在 classes.head_teacher_id 上记录班主任、没写 class_teachers，
 *     这些班级在新的多对多模型下会被误判为「无班主任」。按 head_teacher_id 补一条
 *     role='head_teacher' 的关系。
 *  2. 正向对齐：把每个班的 head_teacher_id 重算为其最早设置的班主任；
 *     若该班在 class_teachers 里已无任何班主任，则置空。
 */
exports.up = async function (knex) {
  const orphanClasses = await knex('classes')
    .select('id', 'name', 'head_teacher_id')
    .whereNotNull('head_teacher_id')
    .whereNotExists(function () {
      this.select(knex.raw('1'))
        .from('class_teachers')
        .whereRaw('class_teachers.class_id = classes.id')
        .whereRaw("class_teachers.role = 'head_teacher'");
    });

  for (const row of orphanClasses) {
    const teacher = await knex('users').select('id', 'role').where('id', row.head_teacher_id).first();
    if (!teacher || teacher.role !== 'teacher') {
      // 指向的用户已不存在或不是教师：不补关系，仅清空悬空引用
      await knex('classes').where('id', row.id).update({ head_teacher_id: null });
      console.log(`  ✓ 班级 #${row.id}「${row.name}」的 head_teacher_id=${row.head_teacher_id} 无对应教师，已清空`);
      continue;
    }
    await knex('class_teachers')
      .insert({ class_id: row.id, teacher_id: teacher.id, role: 'head_teacher' })
      .onConflict(['class_id', 'teacher_id'])
      .ignore();
    console.log(`  ✓ 班级 #${row.id}「${row.name}」补全班主任关系：教师 #${teacher.id}`);
  }

  // 正向对齐：head_teacher_id = 该班最早设置的班主任
  const allClasses = await knex('classes').select('id', 'name', 'head_teacher_id');
  for (const row of allClasses) {
    const primary = await knex('class_teachers')
      .select('teacher_id')
      .where('class_id', row.id)
      .where('role', 'head_teacher')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .first();
    const expected = primary ? primary.teacher_id : null;
    const current = row.head_teacher_id == null ? null : Number(row.head_teacher_id);
    if (current !== expected) {
      await knex('classes').where('id', row.id).update({ head_teacher_id: expected });
      console.log(`  ✓ 班级 #${row.id}「${row.name}」主班主任：${current} → ${expected}`);
    }
  }
};

exports.down = async function () {
  // 不回滚：补全出的 class_teachers 关系与主班主任对齐都是符合业务语义的真实数据，
  // 回滚会把原本可见的班主任变成「无人管理」的班级。
};