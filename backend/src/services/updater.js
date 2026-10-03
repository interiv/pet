/**
 * 软件升级服务：基础设施与工具
 * 业务流程见 upgrade.js（本文件只放常量与通用工具）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const semver = require('semver');
const tar = require('tar');
const axios = require('axios');
const { db } = require('../config/database');
const { getCurrentVersion, BACKEND_DIR } = require('../utils/version');
const { detectRuntime } = require('../utils/runtime');

// 升级包只允许覆盖这些目录（相对 backend/）
const DEFAULT_TARGETS = ['src', 'migrations', 'seeds', 'public'];
// 数据库与上传目录永远不动
const PROTECTED = ['data', 'node_modules', '.env', 'knexfile.js'];

const DATA_DIR = path.join(BACKEND_DIR, 'data');
const UPDATE_DIR = path.join(DATA_DIR, 'updates');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LOG_FILE = path.join(DATA_DIR, 'update-log.jsonl');
const KEEP_BACKUPS = 5;
const SETTING_KEY = 'update_manifest_url';

function ensureDirs() {
  for (const dir of [DATA_DIR, UPDATE_DIR, BACKUP_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function appendLog(entry) {
  ensureDirs();
  const line = JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry));
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  console.log('[升级] ' + line);
}

function getManifestUrl() {
  try {
    ensureDirs();
    const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`).get();
    if (!hasTable) return '';
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY);
    return row && row.value ? String(row.value).trim() : '';
  } catch (e) {
    return '';
  }
}

function setManifestUrl(url) {
  ensureDirs();
  const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='settings'`).get();
  if (!hasTable) throw new Error('settings 表不存在，请先完成数据库初始化');
  const clean = String(url || '').trim();
  if (clean) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(SETTING_KEY, clean);
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run(SETTING_KEY);
  }
}

module.exports = {
  DEFAULT_TARGETS, PROTECTED, DATA_DIR, UPDATE_DIR, BACKUP_DIR, LOG_FILE,
  KEEP_BACKUPS, SETTING_KEY, ensureDirs, formatSize, sha256File, appendLog,
  getManifestUrl, setManifestUrl, getCurrentVersion, detectRuntime,
  semver, tar, axios, fs, path, crypto, db, BACKEND_DIR,
};

// ============================================================================
// 升级状态机
// ============================================================================
const state = {
  running: false,
  phase: 'idle',      // idle | checking | downloading | backing-up | extracting | migrating | done | failed | rolling-back
  message: '',
  progress: 0,        // 0-100
  startedAt: null,
  finishedAt: null,
  lastResult: null,
  lastError: null,
};

function setPhase(phase, message, progress) {
  state.phase = phase;
  state.message = message;
  if (typeof progress === 'number') state.progress = progress;
  console.log(`[升级][${phase}] ${message}`);
}

function getState() {
  return Object.assign({}, state);
}

/** 拉取并校验远端清单 */
async function fetchManifest(url) {
  const target = String(url || '').trim();
  if (!target) throw new Error('未配置更新源地址');
  if (!/^https?:\/\//i.test(target)) throw new Error('更新源地址必须以 http:// 或 https:// 开头');

  const res = await axios.get(target, {
    timeout: 15000,
    responseType: 'json',
    // 清单来源由站点管理员自行配置，放开私网地址（很多学校部署在内网）
    maxRedirects: 3,
    headers: { 'Cache-Control': 'no-cache' },
  });

  const m = res.data;
  if (!m || typeof m !== 'object') throw new Error('更新源返回的内容不是合法 JSON');
  const version = String(m.version || '').replace(/^v/i, '').trim();
  if (!semver.valid(version)) throw new Error('更新源缺少合法的 version 字段（需 semver，如 1.2.0）');
  if (!m.package || !m.package.url || !m.package.sha256) {
    throw new Error('更新源缺少 package.url 或 package.sha256，无法安全升级');
  }
  return Object.assign({}, m, { version });
}

/**
 * 检查更新
 * @returns 当前版本、目标版本、是否有更新、更新日志等
 */
async function checkForUpdates() {
  const current = getCurrentVersion();
  const url = getManifestUrl();
  const runtime = detectRuntime();

  const base = {
    current,
    currentValid: semver.valid(current) ? current : null,
    manifestUrl: url,
    runtime,
    checkedAt: new Date().toISOString(),
  };

  if (!url) {
    return Object.assign(base, {
      ok: false,
      hasUpdate: false,
      error: '尚未配置更新源地址',
    });
  }

  try {
    setPhase('checking', '正在获取更新信息...', 10);
    const manifest = await fetchManifest(url);
    const latest = manifest.version;
    const comparable = semver.valid(current) ? current : '0.0.0';
    const hasUpdate = semver.gt(latest, comparable);

    let minVersionOk = true;
    if (manifest.minVersion && semver.valid(manifest.minVersion)) {
      minVersionOk = semver.gte(comparable, manifest.minVersion);
    }

    setPhase('idle', '', 0);
    return Object.assign(base, {
      ok: true,
      hasUpdate,
      latest,
      minVersionOk,
      changelog: manifest.changelog || manifest.releaseNotes || '',
      releasedAt: manifest.releasedAt || null,
      packageSize: manifest.package.size || null,
      packageSizeText: manifest.package.size ? formatSize(manifest.package.size) : '-',
      requireMigrations: manifest.requireMigrations !== false,
      needRestart: manifest.needRestart !== false,
      targets: manifest.targets || DEFAULT_TARGETS,
      docker: manifest.docker || null,
    });
  } catch (error) {
    setPhase('idle', '', 0);
    return Object.assign(base, {
      ok: false,
      hasUpdate: false,
      error: error.message,
    });
  }
}

// ============================================================================
// 升级执行
// ============================================================================

/** 目标目录白名单：只允许 manifest 声明的目录，且必须在 backend/ 内 */
function resolveTargets(targets) {
  const list = Array.isArray(targets) && targets.length > 0 ? targets : DEFAULT_TARGETS;
  return list.map((t) => {
    const clean = String(t).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!clean) throw new Error('更新源声明的目标目录为空');
    if (clean.split('/').some((seg) => seg === '..' || seg === '.')) {
      throw new Error('更新源声明的目标目录非法：' + t);
    }
    if (PROTECTED.includes(clean) || PROTECTED.some((p) => clean.startsWith(p + '/'))) {
      throw new Error('禁止覆盖受保护目录：' + clean);
    }
    const abs = path.resolve(BACKEND_DIR, clean);
    if (!abs.startsWith(BACKEND_DIR + path.sep)) {
      throw new Error('目标目录越界：' + t);
    }
    return clean;
  });
}

/** 下载升级包到本地并校验 sha256 */
async function downloadPackage(manifest) {
  ensureDirs();
  const fileName = 'pet-' + manifest.version + '.tar.gz';
  const dest = path.join(UPDATE_DIR, fileName);
  const tmp = dest + '.part';

  setPhase('downloading', '正在下载升级包...', 20);
  const res = await axios.get(manifest.package.url, {
    responseType: 'stream',
    timeout: 10 * 60 * 1000,
    maxRedirects: 5,
  });

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(tmp);
    let received = 0;
    const total = Number(res.headers['content-length']) || 0;
    res.data.on('data', (chunk) => {
      received += chunk.length;
      if (total > 0) {
        const pct = 20 + Math.min(35, Math.round((received / total) * 35));
        setPhase('downloading', '正在下载升级包... ' + formatSize(received) + ' / ' + formatSize(total), pct);
      }
    });
    res.data.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    res.data.pipe(ws);
  });

  setPhase('downloading', '正在校验升级包...', 58);
  const actual = await sha256File(tmp);
  const expected = String(manifest.package.sha256).toLowerCase();
  if (actual.toLowerCase() !== expected) {
    fs.unlinkSync(tmp);
    throw new Error('升级包校验失败（sha256 不匹配），可能是下载不完整或文件被篡改');
  }
  fs.renameSync(tmp, dest);
  appendLog({ action: 'download', version: manifest.version, file: fileName, sha256: actual });
  return dest;
}

/** 备份当前将被覆盖的目录 + 版本文件，返回备份包文件名 */
async function backupCurrent(targets, fromVersion) {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = 'backup-' + fromVersion + '-to-' + stamp + '.tar.gz';
  const dest = path.join(BACKUP_DIR, name);
  const existing = targets.filter((t) => fs.existsSync(path.join(BACKEND_DIR, t)));
  // 版本文件必须一起备份，否则回滚后版本号对不上
  const meta = ['VERSION', 'package.json'].filter((f) => fs.existsSync(path.join(BACKEND_DIR, f)));
  const files = existing.concat(meta);
  if (files.length === 0) return null;

  setPhase('backing-up', '正在备份当前程序文件...', 62);
  await tar.create(
    { gzip: true, file: dest, cwd: BACKEND_DIR, portable: true },
    files
  );
  appendLog({ action: 'backup', from: fromVersion, file: name, targets: files });
  pruneBackups();
  return name;
}

/** 只保留最近 N 份备份 */
function pruneBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.tar.gz'))
      .sort();
    while (files.length > KEEP_BACKUPS) {
      const old = files.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }
  } catch (e) { /* 清理失败不影响主流程 */ }
}

/**
 * 解压升级包到暂存目录（做路径白名单校验，防目录穿越）
 * 包内结构约定：顶层就是一个或多个目标目录，如 src/、migrations/、public/
 */
async function extractToStaging(archivePath, targets) {
  const staging = path.join(UPDATE_DIR, 'staging-' + Date.now());
  if (!fs.existsSync(staging)) fs.mkdirSync(staging, { recursive: true });

  setPhase('extracting', '正在解压升级包...', 70);
  await tar.x({ file: archivePath, cwd: staging, preservePaths: false, strict: true });

  // 逐个条目做安全校验：拒绝 ../ 穿越、绝对路径、符号链接
  const allowedTop = new Set(targets);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(staging, abs).replace(/\\/g, '/');
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('升级包包含非法路径：' + rel);
      }
      if (entry.isSymbolicLink()) {
        throw new Error('升级包不允许包含符号链接：' + rel);
      }
      if (entry.isDirectory()) {
        const top = rel.split('/')[0];
        if (!allowedTop.has(top)) {
          throw new Error('升级包包含未授权目录：' + top + '（只允许 ' + targets.join('、') + '）');
        }
        walk(abs);
      }
    }
  };
  walk(staging);
  return staging;
}

/** 递归删除目录（Windows 上 rmSync 对只读文件会失败，先改权限） */
function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const abs = path.join(cur, entry.name);
        try { fs.chmodSync(abs, 0o777); } catch (e2) { /* ignore */ }
        if (entry.isDirectory()) stack.push(abs);
        else fs.unlinkSync(abs);
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 用暂存目录覆盖目标目录 */
function applyStaging(staging, targets) {
  setPhase('extracting', '正在写入新版本文件...', 82);
  const written = [];
  for (const t of targets) {
    const from = path.join(staging, t);
    if (!fs.existsSync(from)) continue;
    const to = path.join(BACKEND_DIR, t);
    // 先搬到一侧再替换，避免中途失败留下半套文件
    const old = to + '.old-' + Date.now();
    if (fs.existsSync(to)) {
      fs.renameSync(to, old);
    }
    fs.cpSync(from, to, { recursive: true });
    removeDir(old);
    written.push(t);
  }
  return written;
}

/** 恢复暂存目录里的根级文件（VERSION / package.json） */
function applyMetaFiles(staging) {
  const restored = [];
  for (const f of ['VERSION', 'package.json']) {
    const from = path.join(staging, f);
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(BACKEND_DIR, f));
      restored.push(f);
    }
  }
  return restored;
}

/**
 * 升级后同步版本号。
 * 关键：VERSION 位于升级包根目录，不在 targets 内，必须单独同步，
 * 否则重启后版本检测仍停在旧版本，下次升级会被误判成「已是最新」。
 */
function syncVersionFromStaging(staging) {
  const stagedVersion = path.join(staging, 'VERSION');
  const target = path.join(BACKEND_DIR, 'VERSION');
  if (fs.existsSync(stagedVersion)) {
    const v = fs.readFileSync(stagedVersion, 'utf8').trim();
    if (semver.valid(v)) {
      fs.writeFileSync(target, v + '\n', 'utf8');
    } else {
      console.warn('[升级] 包内 VERSION 非法，保持原版本号：' + v);
    }
  }
  // package.json 只同步 version 字段，避免覆盖依赖声明
  const stagedPkg = path.join(staging, 'package.json');
  const targetPkg = path.join(BACKEND_DIR, 'package.json');
  if (fs.existsSync(stagedPkg) && fs.existsSync(targetPkg)) {
    try {
      const from = JSON.parse(fs.readFileSync(stagedPkg, 'utf8'));
      if (from && from.version) {
        const cur = JSON.parse(fs.readFileSync(targetPkg, 'utf8'));
        cur.version = from.version;
        fs.writeFileSync(targetPkg, JSON.stringify(cur, null, 2) + '\n', 'utf8');
      }
    } catch (e) {
      console.warn('[升级] 同步 package.json 版本失败（忽略）:', e.message);
    }
  }
}

/**
 * 执行升级（同步，等管理后台轮询进度）
 * @param {string} expectVersion 只接受该版本，防误升级
 */
async function applyUpdate(expectVersion) {
  if (state.running) throw new Error('已有升级任务在进行中，请勿重复点击');
  const current = getCurrentVersion();
  if (expectVersion && semver.valid(expectVersion) && semver.valid(current)
      && semver.eq(expectVersion, current)) {
    throw new Error('当前已经是 ' + current + '，无需升级');
  }

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastError = null;
  state.progress = 5;

  let backupName = null;
  let targets = DEFAULT_TARGETS;
  let manifest = null;

  try {
    manifest = await fetchManifest(getManifestUrl());
    if (expectVersion && manifest.version !== String(expectVersion).replace(/^v/i, '')) {
      throw new Error('更新源上的最新版已变化（' + manifest.version + '），请重新检查更新');
    }
    if (semver.valid(current) && semver.lte(manifest.version, current)) {
      throw new Error('更新源版本（' + manifest.version + '）不高于当前版本（' + current + '）');
    }
    targets = resolveTargets(manifest.targets);

    const archivePath = await downloadPackage(manifest);
    backupName = await backupCurrent(targets, current);
    const staging = await extractToStaging(archivePath, targets);
    const written = applyStaging(staging, targets);
    syncVersionFromStaging(staging);
    removeDir(staging);

    let migrationResult = null;
    if (manifest.requireMigrations !== false) {
      setPhase('migrating', '正在执行数据库结构迁移...', 90);
      const { runMigrations } = require('../config/migrate');
      migrationResult = await runMigrations();
      if (migrationResult.ok === false) {
        throw new Error('数据库迁移失败：' + (migrationResult.error || '未知错误') + '（已回滚程序文件）');
      }
    }

    setPhase('done', '升级完成', 100);
    const result = {
      ok: true,
      from: current,
      to: manifest.version,
      writtenTargets: written,
      appliedMigrations: (migrationResult && migrationResult.applied) || [],
      backup: backupName,
      needRestart: manifest.needRestart !== false,
      restart: detectRuntime(),
      at: new Date().toISOString(),
    };
    state.lastResult = result;
    state.finishedAt = result.at;
    appendLog(Object.assign({ action: 'upgrade' }, result));
    return result;
  } catch (error) {
    setPhase('failed', error.message, 100);
    state.lastError = error.message;
    state.finishedAt = new Date().toISOString();
    appendLog({ action: 'upgrade_failed', from: current, error: error.message });
    throw error;
  } finally {
    state.running = false;
  }
}

/** 列出可用备份 */
function listBackups() {
  ensureDirs();
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('backup-') && f.endsWith('.tar.gz'));
    return files
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        // backup-<from>-to-<时间戳>.tar.gz
        const m = f.match(/^backup-(.+?)-to-(.+)\.tar\.gz$/);
        return {
          file: f,
          from: m ? m[1] : '?',
          createdAt: m ? m[2] : st.mtime.toISOString(),
          size: st.size,
          sizeText: formatSize(st.size),
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch (e) {
    return [];
  }
}

/** 从备份回滚（只恢复程序文件，不回滚数据库） */
async function rollbackTo(backupFile) {
  if (state.running) throw new Error('已有升级任务在进行中，请稍后');
  const name = String(backupFile || '').trim();
  if (!/^backup-[\w.-]+\.tar\.gz$/.test(name)) throw new Error('备份文件名非法');

  const archivePath = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(archivePath)) throw new Error('备份文件不存在：' + name);

  state.running = true;
  setPhase('rolling-back', '正在从备份恢复...', 20);
  try {
    const staging = path.join(UPDATE_DIR, 'rollback-' + Date.now());
    fs.mkdirSync(staging, { recursive: true });
    await tar.x({ file: archivePath, cwd: staging, preservePaths: false, strict: true });

    const entries = fs.readdirSync(staging, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const metaFiles = fs.readdirSync(staging, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
    if (entries.length === 0 && metaFiles.length === 0) throw new Error('备份内容为空，无法恢复');

    // 恢复前先把当前状态也备份一份（回滚也能反悔）
    const safety = await backupCurrent(entries, getCurrentVersion() + '-before-rollback');
    const written = applyStaging(staging, entries);
    const restoredMeta = applyMetaFiles(staging);
    removeDir(staging);

    setPhase('done', '回滚完成', 100);
    const result = {
      ok: true,
      restoredFrom: name,
      writtenTargets: written,
      restoredFiles: restoredMeta,
      backup: safety,
      needRestart: true,
      restart: detectRuntime(),
      at: new Date().toISOString(),
    };
    state.lastResult = result;
    appendLog(Object.assign({ action: 'rollback' }, result));
    return result;
  } catch (error) {
    setPhase('failed', error.message, 100);
    state.lastError = error.message;
    appendLog({ action: 'rollback_failed', error: error.message });
    throw error;
  } finally {
    state.running = false;
  }
}

/** 清理下载缓存（保留最近 3 个包） */
function pruneDownloads() {
  try {
    const files = fs.readdirSync(UPDATE_DIR)
      .filter((f) => f.startsWith('pet-') && f.endsWith('.tar.gz'))
      .sort();
    while (files.length > 3) fs.unlinkSync(path.join(UPDATE_DIR, files.shift()));
  } catch (e) { /* ignore */ }
}

/** 读取最近若干条升级日志 */
function readLog(limit = 20) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => {
      try { return JSON.parse(l); } catch (e) { return { raw: l }; }
    });
  } catch (e) {
    return [];
  }
}

module.exports.checkForUpdates = checkForUpdates;
module.exports.applyUpdate = applyUpdate;
module.exports.rollbackTo = rollbackTo;
module.exports.listBackups = listBackups;
module.exports.readLog = readLog;
module.exports.getState = getState;
module.exports.pruneDownloads = pruneDownloads;



