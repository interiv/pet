/**
 * 探测部署方式，给出「升级完成后如何重启」的可靠指引。
 *
 * 原则：容器内绝不自杀式重启（容器重建会丢掉文件改动，且请求会中断），
 * 只把命令告诉管理员，由他在服务器上执行；PM2 托管时允许一键重启。
 */
const fs = require('fs');
const { isInDocker, getPm2Name } = require('./version');

function detectRuntime() {
  if (isInDocker()) {
    return {
      type: 'docker',
      label: 'Docker 容器',
      canSelfRestart: false,
      restartCommand: 'docker compose pull && docker compose up -d',
      note: '容器内改的文件会在容器重建后丢失。Docker 部署建议用上面的命令拉取新镜像；本功能可先做一次热更新，重建镜像后仍以镜像内容为准。',
    };
  }

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
