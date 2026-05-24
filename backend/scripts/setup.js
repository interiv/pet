#!/usr/bin/env node

/**
 * 数据库统一初始化脚本 (Knex 标准流程)
 *
 * 用法:
 *   node scripts/setup.js                      完整初始化（迁移 + 种子数据）
 *   node scripts/setup.js --clean              仅删除旧数据库
 *
 * 流程:
 *   1. (可选) 删除旧数据库
 *   2. knex migrate:latest  — 创建/更新表结构
 *   3. knex seed:run        — 填充基础数据 + 测试数据
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const args = process.argv.slice(2);

const runClean = args.includes('--clean');

// ---- 清理旧数据库 ----
if (runClean) {
  console.log('=== 清理旧数据库 ===\n');
  const dataDir = path.join(projectRoot, 'data');
  if (fs.existsSync(dataDir)) {
    const dbFiles = fs.readdirSync(dataDir).filter(f => f.startsWith('database') && f.endsWith('.sqlite'));
    dbFiles.forEach(f => {
      try { fs.unlinkSync(path.join(dataDir, f)); console.log(`  已删除 ${f}`); } catch (e) {}
    });
    ['-wal', '-shm'].forEach(ext => {
      const p = path.join(dataDir, `database.sqlite${ext}`);
      if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch (e) {}
    });
  }

  // 如果只清理，直接退出
  if (args.length === 1 || (args.length === 2 && args.includes('--clean'))) {
    console.log('\n清理完成。');
    process.exit(0);
  }
}

// ---- 步骤 1: 数据库迁移 ----
console.log('\n========================================');
console.log('步骤 1: 数据库迁移 (migrate)');
console.log('========================================\n');

try {
  execSync('npx knex migrate:latest --knexfile knexfile.js --env production', {
    stdio: 'inherit',
    cwd: projectRoot
  });
  console.log('\n  迁移完成。');
} catch (err) {
  console.error('迁移失败:', err.message);
  process.exit(1);
}

// ---- 步骤 2: 种子数据 ----
console.log('\n========================================');
console.log('步骤 2: 种子数据 (seed)');
console.log('========================================\n');

try {
  execSync('npx knex seed:run --knexfile knexfile.js --env production', {
    stdio: 'inherit',
    cwd: projectRoot
  });
  console.log('\n  种子数据创建完成。');
} catch (err) {
  console.error('种子数据创建失败:', err.message);
  process.exit(1);
}

console.log('\n========================================');
console.log('  初始化完成！');
console.log('========================================\n');

console.log('基础账号（密码均为 111111）：');
console.log('  管理员: admin');
console.log('  教师:   teacher1 ~ teacher10');
console.log('  学生:   student1 ~ student50');
console.log('');