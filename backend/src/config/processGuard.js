/**
 * 进程守护 / 停止原因记录
 *
 * 背景：
 *   线上出现过「日志最后一条是某次正常请求（200），然后服务端就没了」的情况。
 *   排查时完全无从下手，因为 Node 的默认行为是：
 *     · 未捕获异常（uncaughtException）     → 进程直接退出（堆栈打到 stderr）
 *     · 未处理的 Promise 拒绝（Node ≥15）   → 进程直接退出（堆栈打到 stderr）
 *     · 被外部信号杀掉（SIGTERM/SIGINT）    → 静默退出，什么都不打
 *     · 端口被占用（EADDRINUSE）            → 未捕获异常退出
 *   而后端所有业务日志（morgan 的请求日志、console.log）都走 stdout，
 *   崩溃堆栈走 stderr。面板/宝塔日志经常只收集 stdout，于是看起来就是
 *   「日志停在一条正常请求，然后没有然后了」。
 *
 * 本模块做的事：
 *   1. 给上述四类「停止」全部挂上处理，把**停止原因**同时写到
 *      控制台和磁盘文件 data/logs/server-lifecycle.log（挂载卷里，重启不丢）；
 *   2. 文件写到 1MB 自动轮转，避免无限增长；
 *   3. 收到停止信号时先记录「是谁让我停的」，再优雅关闭 HTTP/Socket；
 *   4. 定期打一条内存快照，便于判断是不是被 OOM 杀掉（OOM 是 SIGKILL，程序无法感知，
 *      只能靠崩溃前的内存曲线推断）。
 *
 * 注意：本模块只负责「记录 + 尽量优雅退出」，不改变业务逻辑。
 */

const fs = require('fs');
const path = require('path');
const { formatChinaTime } = require('./logger');

/** 日志目录：放在 data 卷里，容器重建/重启后仍在，方便事后回溯 */
const LOG_DIR = path.join(__dirname, '../../data/logs');
const LOG_FILE = path.join(LOG_DIR, 'server-lifecycle.log');
/** 单文件上限，超过后轮转为 .1 并重新开始 */
const MAX_LOG_BYTES = 1024 * 1024;

/** 进程启动时间（模块加载即记录） */
const BOOT_AT = Date.now();

/** 已登记的服务对象，用于优雅关闭 */
let httpServer = null;
let socketServer = null;
/** 是否已安装，避免重复挂载 */
let installed = false;
/** 是否正在退出，避免信号/异常重复触发退出流程 */
let shuttingDown = false;

/**
 * 读取布尔型环境变量。
 * @param {string} name @param {boolean} fallback
 */
function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

/**
 * 确保日志目录存在（只尝试一次，失败不抛错，避免守护逻辑本身把进程搞挂）
 */
function ensureDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 超过上限就轮转一次（当前文件 → .1，旧的 .1 直接覆盖）
 */
function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const { size } = fs.statSync(LOG_FILE);
    if (size < MAX_LOG_BYTES) return;
    try { fs.rmSync(`${LOG_FILE}.1`, { force: true }); } catch (e) { /* 忽略 */ }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch (e) {
    /* 轮转失败不影响写日志 */
  }
}

/** 内存快照，用于事后判断是否接近 OOM */
function memorySnapshot() {
  const m = process.memoryUsage();
  const mb = (n) => Math.round((n / 1024 / 1024) * 10) / 10;
  return `rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB external=${mb(m.external)}MB`;
}

/** 进程存活时长（人类可读） */
function uptimeText() {
  const s = Math.round((Date.now() - BOOT_AT) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h${m}m${s % 60}s（共 ${s} 秒）`;
}

/**
 * 把一条「生命周期事件」同时写到控制台与磁盘。
 *
 * @param {'INFO'|'WARN'|'ERROR'|'FATAL'} level
 * @param {string} message  要记录的内容（越具体越好，写清「为什么停」）
 * @param {Error|object} [detail] 附带错误对象（会打印 stack）
 */
function logEvent(level, message, detail) {
  // 控制台：logger.js 已给 console 打过时间戳补丁，这里不用再加
  const consoleFn = level === 'ERROR' || level === 'FATAL'
    ? console.error
    : (level === 'WARN' ? console.warn : console.log);

  // 控制台：logger.js 已给 console 打过补丁（自动带「时间戳 + 级别」），
  // 这里只传正文，否则会出现 [时间] [INFO] [INFO] 这样的重复前缀。
  const detailText = detail
    ? (detail instanceof Error
      ? (detail.stack || detail.message)
      : (typeof detail === 'string' ? detail : JSON.stringify(detail)))
    : '';
  try {
    consoleFn(message);
    if (detailText) consoleFn(`  ${detailText}`);
  } catch (e) {
    /* 控制台写入失败也不能让守护逻辑崩掉 */
  }

  // 落盘：用 appendFileSync 保证崩溃瞬间也写得进去（异步写会来不及）。
  // 文件里没有 logger 的补丁，所以自己带上时间戳。
  try {
    ensureDir();
    rotateIfNeeded();
    const extra = detailText ? `\n  ${detailText}` : '';
    fs.appendFileSync(LOG_FILE, `[${formatChinaTime()}] [${level}] ${message}${extra}\n`, 'utf8');
  } catch (e) {
    try { console.error(`[WARN] 生命周期日志写入磁盘失败: ${e.message}`); } catch (_) { /* 忽略 */ }
  }
}

/** 统一的事件上下文：记录当时的内存与存活时长，事后看日志能立刻判断是不是「快撑爆了」 */
function contextText() {
  return `${memorySnapshot()}，已运行 ${uptimeText()}`;
}

/**
 * 优雅关闭：先关 Socket.IO（否则长连接会让 server.close 一直不回调），再关 HTTP。
 * 无论如何 5 秒后强退，避免卡死。
 * @param {number} code
 */
function shutdownGracefully(code) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    process.exit(code);
  };

  try {
    if (socketServer && typeof socketServer.close === 'function') socketServer.close();
  } catch (e) { /* 忽略 */ }
  try {
    if (httpServer && typeof httpServer.close === 'function') {
      httpServer.close(() => {
        logEvent('INFO', `✅ HTTP 服务已关闭，进程退出（code=${code}）`);
        finish();
      });
    } else {
      finish();
    }
  } catch (e) {
    finish();
  }

  // 兜底：5 秒还没退干净就强制退出（比如还有挂着的长连接）
  const t = setTimeout(() => {
    logEvent('WARN', `优雅关闭超时（5 秒），强制退出（code=${code}）`);
    finish();
  }, 5000);
  if (typeof t.unref === 'function') t.unref();
}

/**
 * 安装全局守护。必须在程序入口**尽早**调用，否则启动阶段的异常兜不住。
 * 幂等：重复调用只生效一次。
 */
function install() {
  if (installed) return;
  installed = true;

  logEvent('INFO', `进程守护已安装（pid=${process.pid}，node=${process.version}，NODE_ENV=${process.env.NODE_ENV || 'development'}）`);
  logEvent('INFO', `生命周期日志文件：${LOG_FILE}`);

  // ① 未捕获异常：这是最常见的「服务端突然没了」。
  //    Node 默认直接退出，这里先把它完整记下来再退（状态已不可控，继续跑更危险）。
  //    如果部署环境没有自动拉起（nohup/宝塔手动启动），可设 GUARD_EXIT_ON_UNCAUGHT=0 让它只记录不退出。
  process.on('uncaughtException', (err) => {
    logEvent('FATAL', `❗ 未捕获异常，进程即将退出。原因：${err && err.message ? err.message : err}。上下文：${contextText()}`, err);
    if (err && err.code === 'EADDRINUSE') {
      logEvent('FATAL', `端口 ${process.env.PORT || 3000} 已被占用：多半是旧进程没退干净，或同机跑了第二份后端。请先结束占用进程再启动。`);
    }
    if (!envBool('GUARD_EXIT_ON_UNCAUGHT', true)) {
      logEvent('WARN', 'GUARD_EXIT_ON_UNCAUGHT=0：已阻止退出，服务继续运行（状态可能不一致，建议尽快修复并重启）');
      return;
    }
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownGracefully(1);
  });

  // ② 未处理的 Promise 拒绝：Node ≥15 默认也是直接退出。
  //    默认策略改为「只记录、不退出」——一次偶发 rejection 不该让整站下线；
  //    需要恢复 Node 原生「崩掉让容器重启」的行为时设 GUARD_EXIT_ON_REJECTION=1。
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logEvent('ERROR', `❗ 未处理的 Promise 拒绝（此类问题在 Node ≥15 默认会直接终止进程，正是「日志停在一条正常请求后就没了」的高发原因）。原因：${err.message}。上下文：${contextText()}`, err);
    if (!envBool('GUARD_EXIT_ON_REJECTION', false)) return;
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownGracefully(1);
  });

  // ③ 停止信号：Docker stop / 宝塔重启 / systemctl / Ctrl+C / 终端关闭。
  //    这类停止是「外部要求」的，程序本身不会报错，所以必须主动记一笔。
  ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK'].forEach((sig) => {
    try {
      process.on(sig, () => {
        const who = {
          SIGTERM: '收到 SIGTERM：通常是 docker stop / systemctl stop / 面板点「停止」/ 部署脚本重启',
          SIGINT: '收到 SIGINT：通常是终端里按了 Ctrl+C，或运行终端被关闭',
          SIGHUP: '收到 SIGHUP：通常是启动它的终端/SSH 会话断开（nohup 未生效时最典型）',
          SIGBREAK: '收到 SIGBREAK：Windows 下的中断信号',
        }[sig] || `收到信号 ${sig}`;
        logEvent('WARN', `🛑 ${who}，即将退出。上下文：${contextText()}`);
        if (shuttingDown) return;
        shuttingDown = true;
        shutdownGracefully(0);
      });
    } catch (e) {
      /* 某些平台不支持 SIGBREAK，忽略 */
    }
  });

  // ④ 进程退出兜底：无论什么原因走到这一步，都留下退出码和存活时长。
  //    若退出码是 1 而上面没记到 FATAL，说明是别的原因（如被 SIGKILL，见下方内存兜底）。
  process.on('exit', (code) => {
    logEvent(code === 0 ? 'INFO' : 'ERROR', `进程退出，退出码=${code}（存活 ${uptimeText()}）。若上方没有 FATAL/ERROR 记录，则很可能是被外部强制杀死（如 OOM 的 SIGKILL、面板强制停止、宿主机重启）——这类信号程序无法感知。`);
  });

  // ⑤ Node 警告（含 MaxListenersExceeded、内存告警等），留痕便于定位隐患
  process.on('warning', (w) => {
    logEvent('WARN', `Node 警告：${w.name}: ${w.message}`, w.stack);
  });

  // ⑥ 内存快照：OOM 是 SIGKILL，进程无感知，只能靠「崩溃前的内存走势」判断。
  //    默认每 30 分钟一条；设 MEMORY_WATCH_INTERVAL_MS=0 可关闭。
  const interval = Number(process.env.MEMORY_WATCH_INTERVAL_MS ?? 30 * 60 * 1000);
  if (Number.isFinite(interval) && interval > 0) {
    const timer = setInterval(() => {
      logEvent('INFO', `内存快照：${memorySnapshot()}，已运行 ${uptimeText()}`);
    }, interval);
    if (typeof timer.unref === 'function') timer.unref();
  }
}

/**
 * 登记 HTTP / Socket.IO 实例，供优雅关闭与 listen 报错定位使用。
 * 在 `http.createServer` / `new Server(...)` 之后调用即可。
 *
 * @param {{ server?: import('http').Server, io?: import('socket.io').Server }} refs
 */
function register(refs = {}) {
  if (refs.server) httpServer = refs.server;
  if (refs.io) socketServer = refs.io;

  // listen 失败（端口占用等）会以 'error' 事件抛出；没人监听就是未捕获异常 → 进程退出
  if (httpServer && typeof httpServer.on === 'function') {
    httpServer.on('error', (err) => {
      logEvent('FATAL', `HTTP 服务监听出错：${err.code || ''} ${err.message}。上下文：${contextText()}`, err);
      if (err.code === 'EADDRINUSE') {
        logEvent('FATAL', `端口被占用：请检查是否有旧的后端进程仍在运行（更常见），或同一个端口启动了多份服务。`);
      }
      if (shuttingDown) return;
      shuttingDown = true;
      shutdownGracefully(1);
    });
  }
}

module.exports = { install, register, logEvent };
