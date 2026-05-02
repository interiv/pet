#!/usr/bin/env node

/**
 * 数据库统一初始化脚本
 * 
 * 用法:
 *   node scripts/setup.js                    完整初始化（数据库+班级+成就）
 *   node scripts/setup.js --db               仅初始化数据库
 *   node scripts/setup.js --classes          仅设置班级
 *   node scripts/setup.js --achievements     仅初始化成就
 *   node scripts/setup.js --db --test-data   初始化数据库并创建丰富测试数据
 *   node scripts/setup.js --achievements --force  强制覆盖成就数据
 *   node scripts/setup.js --clean            仅删除旧数据库
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const scriptsDir = __dirname;
const args = process.argv.slice(2);

const runDb = args.includes('--db') || args.length === 0;
const runClasses = args.includes('--classes') || args.length === 0;
const runAchievements = args.includes('--achievements') || args.length === 0;
const runClean = args.includes('--clean');

if (runClean || runDb) {
  console.log('=== 清理旧数据库 ===\n');
  const dataDir = path.join(scriptsDir, '../data');
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir);
    const dbFiles = files.filter(f => f.startsWith('database') && f.endsWith('.sqlite'));
    dbFiles.forEach(f => {
      const filePath = path.join(dataDir, f);
      try {
        fs.unlinkSync(filePath);
        console.log(`✓ 已删除 ${f}`);
      } catch (e) {
        console.log(`⚠  无法删除 ${f}，可能被其他进程占用`);
      }
    });
    // Also delete WAL and SHM files
    ['-wal', '-shm'].forEach(ext => {
      const walPath = path.join(dataDir, `database.sqlite${ext}`);
      if (fs.existsSync(walPath)) {
        try { fs.unlinkSync(walPath); } catch (e) {}
      }
    });
    console.log('');
  }
}

if (runClean && !runDb && !runClasses && !runAchievements) {
  process.exit(0);
}

if (runDb) {
  console.log('\n========================================');
  console.log('步骤 1: 初始化数据库');
  console.log('========================================\n');
  const dbArgs = args.includes('--test-data') ? ['--test-data'] : [];
  execSync(`node "${path.join(scriptsDir, 'init_db.js')}" ${dbArgs.join(' ')}`, { stdio: 'inherit', cwd: path.join(scriptsDir, '..') });
}

if (runClasses) {
  console.log('\n========================================');
  console.log('步骤 2: 设置班级');
  console.log('========================================\n');
  execSync(`node "${path.join(scriptsDir, 'setup_classes.js')}"`, { stdio: 'inherit', cwd: path.join(scriptsDir, '..') });
}

if (runAchievements) {
  console.log('\n========================================');
  console.log('步骤 3: 初始化成就');
  console.log('========================================\n');
  const achArgs = args.includes('--force') ? ['--force'] : [];
  execSync(`node "${path.join(scriptsDir, 'seed_achievements.js')}" ${achArgs.join(' ')}`, { stdio: 'inherit', cwd: path.join(scriptsDir, '..') });
}

console.log('\n========================================');
console.log('✅ 所有初始化步骤完成！');
console.log('========================================\n');
