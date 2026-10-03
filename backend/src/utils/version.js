/**
 * 版本信息：软件升级功能的基础
 *
 * 版本号来源优先级：
 *   1) backend/VERSION 文件（发布时由 scripts/release.mjs 写入，最准）
 *   2) backend/package.json 的 version（老版本没有 VERSION 文件时回退）
 *
 * 另外提供运行环境探测（Docker / PM2 / systemd / 裸机），
 * 决定「升级完成后该怎么重启」，避免在容器里把自己重启掉。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// backend/ 目录（src/utils → ../../ = backend）
const BACKEND_DIR = path.join(__dirname, '..', '..');
const VERSION_FILE = path.join(BACKEND_DIR, 'VERSION');

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_DIR, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
}

/** 读取当前版本号（不含 v 前缀） */
function getCurrentVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const v = fs.readFileSync(VERSION_FILE, 'utf8').trim().replace(/^v/i, '');
      if (v) return v;
    }
  } catch (e) { /* 读不到就回退 package.json */ }
  return readPackageVersion();
}

/** 首次运行时把版本号落盘，之后都以 VERSION 文件为准 */
function ensureVersionFile() {
  if (fs.existsSync(VERSION_FILE)) return getCurrentVersion();
  const v = readPackageVersion();
  try {
    fs.writeFileSync(VERSION_FILE, `${v}\n`, 'utf8');
  } catch (e) {
    console.warn('⚠️ 写入 VERSION 文件失败（升级功能可能无法识别新版本）:', e.message);
  }
  return v;
}

/** 读一次 git 提交号（Docker 镜像里通常没有 .git，允许为 null） */
function getGitCommit() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: BACKEND_DIR,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).toString().trim();
    return out || null;
  } catch (e) {
    return null;
  }
}

let inDockerCache = null;
function isInDocker() {
  if (inDockerCache !== null) return inDockerCache;
  try {
    if (fs.existsSync('/.dockerenv')) {
      inDockerCache = true;
      return true;
    }
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    inDockerCache = /docker|containerd|kubepods/.test(cgroup);
  } catch (e) {
    inDockerCache = false;
  }
  return inDockerCache;
}

let pm2NameCache = null;
function getPm2Name() {
  if (pm2NameCache !== null) return pm2NameCache;
  if (process.env.PM2_APP_NAME) {
    pm2NameCache = process.env.PM2_APP_NAME;
    return pm2NameCache;
  }
  if (!process.env.PM2_HOME) return (pm2NameCache = false);
  try {
    const out = execFileSync('pm2', ['jlist'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).toString();
    const list = JSON.parse(out || '[]');
    const matched = list.find((p) => p.pm2_env && p.pm2_env.pm_cwd && p.pm2_env.pm_cwd.includes(BACKEND_DIR));
    if (matched) return (pm2NameCache = matched.name);
    if (list.length === 1) return (pm2NameCache = list[0].name);
    return (pm2NameCache = false);
  } catch (e) {
    return (pm2NameCache = false);
  }
}

module.exports = {
  BACKEND_DIR,
  VERSION_FILE,
  getCurrentVersion,
  ensureVersionFile,
  getGitCommit,
  isInDocker,
  getPm2Name,
};
