/**
 * 探测运行方式，给出「升级完成后如何重启」的可靠指引。
 *
 * 原则：没有进程托管时绝不自杀式重启（重启会中断请求，且没人再把服务拉起来），
 * 只把命令告诉管理员，由他在服务器上执行；PM2 托管时允许一键重启。
 */
const fs = require('fs');
const { getPm2Name } = require('./version');

function detectRuntime() {
  const pm2Name = getPm2Name();
  if (pm2Name) {
    return {
      type: 'pm2',
      label: 'PM2 进程（' + pm2Name + '）',
      canSelfRestart: true,
      restartCommand: 'pm2 restart ' + pm2Name,
      note: '点「重启服务」按钮即可生效；也可手动执行上面的命令。',
    };
  }

  if (process.platform === 'linux' && fs.existsSync('/run/systemd/system')) {
    return {
      type: 'systemd',
      label: 'Linux systemd 服务',
      canSelfRestart: false,
      restartCommand: 'sudo systemctl restart class-pet',
      note: '服务由 systemd 托管，请执行上面的命令重启（把 class-pet 换成你的服务名）。',
    };
  }

  return {
    type: 'manual',
    label: process.platform === 'win32' ? 'Windows 直接运行' : '直接运行 / 其他',
    canSelfRestart: false,
    restartCommand: process.platform === 'win32'
      ? '停止并重新运行 node src/server.js'
      : 'kill 掉进程后重新启动 node src/server.js',
    note: '没有检测到进程管理器，请手动重启服务。',
  };
}

module.exports = { detectRuntime };
