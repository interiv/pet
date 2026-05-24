const bcrypt = require('bcryptjs');
const crypto = require('crypto');

exports.seed = async function (knex) {
  await knex('class_invitations').del();
  await knex('class_teachers').del();
  await knex('classes').del();
  await knex('users').del();

  const saltRounds = 10;
  const password = '111111';
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  await knex('users').insert({
    username: 'admin',
    password_hash: hashedPassword,
    email: 'admin@school.com',
    role: 'admin',
    status: 'active',
  });

  const teacherIds = [];
  for (let i = 1; i <= 10; i++) {
    const username = `teacher${i}`;
    const [id] = await knex('users').insert({
      username,
      password_hash: hashedPassword,
      email: `${username}@school.com`,
      role: 'teacher',
      status: 'active',
    });
    teacherIds.push(id);
  }

  const studentIds = [];
  for (let i = 1; i <= 50; i++) {
    const username = `student${i}`;
    const [id] = await knex('users').insert({
      username,
      password_hash: hashedPassword,
      email: `${username}@school.com`,
      role: 'student',
      status: 'active',
    });
    studentIds.push(id);
  }

  const usedSlugs = new Set();

  function generateSlug(name) {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const suffix = crypto.randomBytes(3).toString('hex');
    return `${base || 'class'}-${suffix}`;
  }

  function uniqueSlug(name) {
    let slug;
    do {
      slug = generateSlug(name);
    } while (usedSlugs.has(slug));
    usedSlugs.add(slug);
    return slug;
  }

  const slug1 = uniqueSlug('1班');
  const [class1Id] = await knex('classes').insert({
    name: '1班',
    slug: slug1,
    student_count: 0,
    total_exp: 0,
  });

  await knex('classes').where('id', class1Id).update({ head_teacher_id: teacherIds[0] });
  await knex('class_teachers').insert({
    class_id: class1Id,
    teacher_id: teacherIds[0],
    role: 'head_teacher',
  });

  for (let i = 1; i <= 6; i++) {
    await knex('class_teachers').insert({
      class_id: class1Id,
      teacher_id: teacherIds[i],
      role: 'teacher',
    });
  }

  for (let i = 0; i < 30; i++) {
    await knex('users').where('id', studentIds[i]).update({ class_id: class1Id });
  }
  await knex('classes').where('id', class1Id).update({ student_count: 30 });

  const invite1 = crypto.randomBytes(4).toString('hex').toUpperCase();
  await knex('class_invitations').insert({
    class_id: class1Id,
    invitation_code: invite1,
    created_by: teacherIds[0],
    role_filter: 'any',
    is_active: 1,
  });

  const slug2 = uniqueSlug('2班');
  const [class2Id] = await knex('classes').insert({
    name: '2班',
    slug: slug2,
    student_count: 0,
    total_exp: 0,
  });

  await knex('classes').where('id', class2Id).update({ head_teacher_id: teacherIds[1] });
  await knex('class_teachers').insert({
    class_id: class2Id,
    teacher_id: teacherIds[1],
    role: 'head_teacher',
  });

  const class2TeacherIndices = [0, 4, 5, 6, 7, 8];
  for (const idx of class2TeacherIndices) {
    await knex('class_teachers').insert({
      class_id: class2Id,
      teacher_id: teacherIds[idx],
      role: 'teacher',
    });
  }

  for (let i = 30; i < 50; i++) {
    await knex('users').where('id', studentIds[i]).update({ class_id: class2Id });
  }
  await knex('classes').where('id', class2Id).update({ student_count: 20 });

  const invite2 = crypto.randomBytes(4).toString('hex').toUpperCase();
  await knex('class_invitations').insert({
    class_id: class2Id,
    invitation_code: invite2,
    created_by: teacherIds[1],
    role_filter: 'any',
    is_active: 1,
  });

  console.log('');
  console.log('基础账号信息（密码均为 111111）：');
  console.log('  管理员: admin');
  console.log('  教师:   teacher1 ~ teacher10');
  console.log('  学生:   student1 ~ student50');
  console.log('');
  console.log('班级信息：');
  console.log('  1班: teacher1(班主任), teacher2~7(科任), student1~30');
  console.log(`  1班邀请码: ${invite1}`);
  console.log('  2班: teacher2(班主任), teacher1,5,6,7,8,9(科任), student31~50');
  console.log(`  2班邀请码: ${invite2}`);

  // 标记测试环境
  await knex('settings').insert({ key: 'show_test_accounts', value: 'true' });
  console.log('');
  console.log('  已标记测试数据环境');
};
