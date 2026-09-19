// 数据库迁移服务
// 1) 后端启动时自动执行迁移（失败只记日志，不阻断服务启动）
// 2) 向管理后台提供迁移状态、手动执行迁移、整体重置（重建表结构 + 基础种子）能力
const knexFactory = require('knex');
const knexfile = require('../../knexfile');

const ENV = process.env.NODE_ENV === 'production' ? 'production' : 'development';

// 迁移状态（供管理后台展示）
const state = {
  ok: null,        // null=尚未执行, true=成功, false=失败
  error: null,
  applied: [],     // 最近一次实际执行的迁移文件
  completed: 0,    // 已执行数量
  pending: 0,      // 待执行数量
  ranAt: null,
  running: false,
};

function createKnex() {
  return knexFactory(knexfile[ENV] || knexfile.development);
}

async function refreshStatus(knexInstance) {
  const knex = knexInstance || createKnex();
  try {
    const [completed, pending] = await knex.migrate.list();
    state.completed = completed.length;
    state.pending = pending.length;
  } finally {
    if (!knexInstance) await knex.destroy();
  }
}

async function runMigrations() {
  if (state.running) return { ...state };
  state.running = true;

  const knex = createKnex();
  try {
    const [batch, applied] = await knex.migrate.latest();
    state.ok = true;
    state.error = null;
    state.applied = applied || [];
    state.ranAt = new Date().toISOString();

    if (state.applied.length > 0) {
      console.log(`✅ 数据库迁移完成（批次 ${batch}，执行 ${state.applied.length} 个）: ${state.applied.join(', ')}`);
    } else {
      console.log('✅ 数据库结构已是最新，无需迁移');
    }
  } catch (error) {
    state.ok = false;
    state.error = error.message;
    state.ranAt = new Date().toISOString();
    console.error('❌ 数据库迁移失败（服务仍会启动，请到管理后台「系统数据」查看）:', error.message);
  } finally {
    try { await refreshStatus(knex); } catch (e) { /* 忽略状态刷新失败 */ }
    await knex.destroy();
    state.running = false;
  }

  return { ...state };
}

// 只执行基础种子数据（seeds 目录里的配置数据 + admin 账号，不含演示数据）
async function runBaseSeeds() {
  const knex = createKnex();
  try {
    await knex.seed.run();
  } finally {
    await knex.destroy();
  }
}

// 重置为全新系统：回滚所有迁移（删表）→ 重新建表 → 灌基础种子数据
async function resetDatabase() {
  const knex = createKnex();
  try {
    await knex.migrate.rollback({}, true);
    await knex.migrate.latest();
    await knex.seed.run();
  } finally {
    await knex.destroy();
  }
  await runMigrations();
}

function getStatus() {
  return { ...state };
}

module.exports = { runMigrations, getStatus, createKnex, refreshStatus, runBaseSeeds, resetDatabase };
