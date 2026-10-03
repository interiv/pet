/**
 * 修复：管理员在后台创建的班级没有 slug，导致该班学生登录后被误判为「入班申请尚未处理」
 *
 * 问题：
 * - 教师自建班级走 POST /classes，会生成 slug；但管理员在后台「班级管理」创建的班级
 *   （POST /admin/classes）历史上不写 slug，classes.slug 为 NULL。
 * - 学生进入工作台依赖 /c/<slug>/app；登录返回的 user.class_slug 取自 classes.slug，
 *   为空时前端 RootRedirect 判定为「还没入班」，于是弹出「您的入班申请尚未处理」。
 * - 这些学生其实是管理员批量导入/生成账号直接放进班级的，本来就已经入班。
 *
 * 做法：为空（或空串）的班级补一个唯一 slug（规则与 utils/slug.js 一致）。
 * 幂等：重复执行不会改动已有 slug。
 */
const crypto = require('crypto');

function generateClassSlug(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fffa-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'class';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

exports.up = async function (knex) {
  const rows = await knex('classes')
    .select('id', 'name', 'slug')
    .where((qb) => qb.whereNull('slug').orWhere('slug', ''));

  for (const row of rows) {
    let slug = generateClassSlug(row.name);
    // 极小概率撞名，追加更长随机串
    const clash = await knex('classes').where('slug', slug).first();
    if (clash) {
      slug = `${slug}-${crypto.randomBytes(4).toString('hex')}`;
    }
    await knex('classes').where('id', row.id).update({ slug });
    console.log(`  ✓ 班级 #${row.id}「${row.name}」补齐 slug: ${slug}`);
  }
};

exports.down = async function () {
  // 不回滚：slug 是学生访问班级的地址，回滚会再次导致学生无法进入工作台
};
