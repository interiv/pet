/**
 * 控制台日志时间戳
 *
 * 作用：给所有 console.log / info / warn / error / debug 输出自动加上
 *       「东八区日期时间 + 日志级别」前缀，这样在 npm start 的终端（宝塔面板日志）
 *       里能直接看出每条日志是什么时候发生的。
 *
 * 用法：在程序入口的最顶部 require 一次即可（见 src/server.js 第一行）：
 *   require('./config/logger');
 *
 * 输出效果：
 *   [2026-09-19 14:23:01.482] [INFO] 服务器运行在端口 3000
 *   [2026-09-19 14:23:05.117] [ERROR] 错误: xxx
 */

// 与 config/timezone.js 保持一致：项目统一使用东八区时间
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad = (num, len = 2) => String(num).padStart(len, '0');

/**
 * 生成东八区时间字符串：YYYY-MM-DD HH:mm:ss.SSS
 */
function formatChinaTime(date = new Date()) {
  const t = new Date(date.getTime() + CHINA_OFFSET_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ` +
    `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}.${pad(t.getUTCMilliseconds(), 3)}`;
}

// 各方法对应的级别标签
const LEVEL_TAGS = {
  log: 'INFO',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  debug: 'DEBUG',
};

let installed = false;

/**
 * 给全局 console 打时间戳补丁（重复调用只会生效一次）
 */
function installConsoleTimestamp() {
  if (installed) return;
  installed = true;

  for (const [method, tag] of Object.entries(LEVEL_TAGS)) {
    const original = typeof console[method] === 'function'
      ? console[method].bind(console)
      : console.log.bind(console);

    console[method] = (...args) => original(`[${formatChinaTime()}] [${tag}]`, ...args);
  }
}

installConsoleTimestamp();

module.exports = { formatChinaTime, installConsoleTimestamp };
