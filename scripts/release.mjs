/**
 * 生成软件升级包 + 更新清单（manifest.json）
 *
 * 用法（在仓库根目录执行）：
 *   node scripts/release.mjs --version 1.1.0 --changelog "修复若干问题" --base-url https://你的域名/releases
 *   node scripts/release.mjs --version 1.1.0 --with-frontend
 *
 * 产物（输出到 release/ 目录）：
 *   pet-<version>.tar.gz   升级包（内含 src / migrations / seeds）
 *   manifest.json          更新清单（填进管理后台「软件升级 -> 更新源地址」）
 *
 * 原理：管理后台只信任带 sha256 的清单，下载后先校验再覆盖，失败可一键回滚。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const hasFlag = (name) => args.includes('--' + name);

const version = getArg('version').replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('请用 --version 指定合法版本号，例如：node scripts/release.mjs --version 1.1.0');
  process.exit(1);
}
const changelog = getArg('changelog', '');
const baseUrl = getArg('base-url', '').replace(/\/+$/, '');
const withFrontend = hasFlag('with-frontend');

const targets = ['src', 'migrations', 'seeds'];
if (withFrontend) {
  if (!fs.existsSync(path.join(ROOT, 'frontend', 'dist'))) {
    console.error('找不到 frontend/dist，请先执行 npm run build（或去掉 --with-frontend）');
    process.exit(1);
  }
  targets.push('public');
}
const missing = targets.filter((t) => t === 'public' || !fs.existsSync(path.join(BACKEND, t)));
if (missing.length) {
  console.error('以下目录不存在：' + missing.join(', '));
  process.exit(1);
}

const OUT = path.join(ROOT, 'release');
const STAGE = path.join(OUT, '.stage-' + version);
const FILE = 'pet-' + version + '.tar.gz';

// 写入版本号（VERSION 是升级判定的唯一依据）
const versionFile = path.join(BACKEND, 'VERSION');
const before = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : '(无)';
const pkgPath = path.join(BACKEND, 'package.json');
const pkgBeforeText = fs.readFileSync(pkgPath, 'utf8');
const pkgBefore = JSON.parse(pkgBeforeText);
fs.writeFileSync(versionFile, version + '\n', 'utf8');
fs.writeFileSync(pkgPath, pkgBeforeText.replace(/("version"\s*:\s*")[^"]+(")/, '$1' + version + '$2'), 'utf8');

// 依赖是否变化：升级包不含 node_modules，依赖变了站点必须自己装一次
const pkgAfter = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const depsChanged = JSON.stringify(pkgBefore.dependencies || {}) !== JSON.stringify(pkgAfter.dependencies || {});
if (depsChanged) {
  console.log('⚠️检测到 package.json 依赖有变化，升级后站点需执行：npm install --omit=dev');
}


let commit = null;
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
} catch (e) { /* 没有 .git 也照样能打包 */ }

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
}
rmrf(STAGE);
fs.mkdirSync(STAGE, { recursive: true });

for (const t of targets) {
  if (t === 'public') {
    const to = path.join(STAGE, 'public');
    fs.cpSync(path.join(ROOT, 'frontend', 'dist'), to, { recursive: true });
    const images = path.join(ROOT, 'frontend', 'public', 'images');
    if (fs.existsSync(images)) fs.cpSync(images, path.join(to, 'images'), { recursive: true, force: true });
  } else {
    fs.cpSync(path.join(BACKEND, t), path.join(STAGE, t), { recursive: true });
  }
}
fs.copyFileSync(pkgPath, path.join(STAGE, 'package.json'));
fs.writeFileSync(path.join(STAGE, 'VERSION'), version + '\n', 'utf8');

fs.mkdirSync(OUT, { recursive: true });
const archive = path.join(OUT, FILE);
execFileSync('tar', ['-czf', archive, '-C', STAGE, '.'], { stdio: 'inherit' });
rmrf(STAGE);

const buf = fs.readFileSync(archive);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

const manifest = {
  version,
  commit,
  releasedAt: new Date().toISOString(),
  changelog: changelog || '（未填写更新日志）',
  minVersion: before === '(无)' ? undefined : before,
  requireMigrations: true,
  needRestart: true,
  // 依赖变化时，站点升级后必须自己跑一次 npm install（升级包不含 node_modules）
  needNpmInstall: depsChanged,
  npmInstallCommand: 'cd backend && npm install --omit=dev',
  targets,
  package: {
    file: FILE,
    size: buf.length,
    sha256,
    url: baseUrl ? baseUrl + '/' + FILE : '【请把 ' + FILE + ' 上传后，把这里改成可下载地址】',
  },
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

// 可选：顺带打一个版本标签（--tag）
if (hasFlag('tag')) {
  const tag = 'v' + version;
  try {
    execFileSync('git', ['tag', '-a', tag, '-m', 'release ' + version], { cwd: ROOT, stdio: 'inherit' });
    console.log('已打标签：' + tag + '（推送：git push origin ' + tag + '）');
  } catch (e) {
    console.log('打标签失败（可能已存在同名标签）：' + e.message);
  }
}

console.log('');
console.log('版本 ' + before + ' -> ' + version);
console.log('升级包：' + path.relative(ROOT, archive) + '（' + (buf.length / 1024 / 1024).toFixed(2) + ' MB）');
console.log('sha256：' + sha256);
console.log('清单：  ' + path.relative(ROOT, path.join(OUT, 'manifest.json')));
if (depsChanged) {
  console.log('');
  console.log('⚠️ 依赖有变化：请在文档/通知里提醒站点升级后执行  npm install --omit=dev');
}
console.log('');
console.log('接下来：');
console.log('  1) 把 ' + FILE + ' 和 manifest.json 一起上传到更新源目录（保持同一目录）');
console.log('  2) 打开 manifest.json，把 package.url 改成真实下载地址');
console.log('  3) 站点管理员登录后台上「软件升级」，把 manifest.json 的地址填进「更新源地址」');
console.log('  4) 点「检查更新」->「立即升级」');
console.log('');
console.log('详见根目录《发布指南.md》');
