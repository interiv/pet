/**
 * 软件升级接口（挂在 /api/admin/system/update）
 * 全部接口仅管理员可用；前端轮询 /status 展示升级进度。
 */
const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const { authenticateToken } = require('../../middleware/auth');
const { requireAdmin } = require('./_shared');
const updater = require('../../services/updater');
const { getCurrentVersion, getGitCommit, BACKEND_DIR } = require('../../utils/version');
const { detectRuntime } = require('../../utils/runtime');

// 运行环境信息（版本、部署方式、目录），管理后台首屏展示
router.get('/info', authenticateToken, requireAdmin, (req, res) => {
  try {
    res.json({
      version: getCurrentVersion(),
      commit: getGitCommit(),
      node: process.version,
      platform: process.platform,
      installDir: BACKEND_DIR,
      runtime: detectRuntime(),
      manifestUrl: updater.getManifestUrl(),
      state: updater.getState(),
    });
  } catch (error) {
    console.error('获取升级信息失败:', error);
    res.status(500).json({ error: '获取升级信息失败' });
  }
});

// 保存更新源地址（清单 manifest.json 的 URL）
router.put('/source', authenticateToken, requireAdmin, (req, res) => {
  try {
    const url = (req.body || {}).url || '';
    updater.setManifestUrl(url);
    res.json({ message: url ? '更新源已保存' : '已清空更新源', manifestUrl: updater.getManifestUrl() });
  } catch (error) {
    console.error('保存更新源失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 检查更新
router.post('/check', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json(await updater.checkForUpdates());
  } catch (error) {
    console.error('检查更新失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 升级进度（前端每 1.5 秒轮询一次）
router.get('/status', authenticateToken, requireAdmin, (req, res) => {
  res.json(updater.getState());
});

// 执行升级
router.post('/apply', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await updater.applyUpdate((req.body || {}).version || '');
    updater.pruneDownloads();
    res.json(result);
  } catch (error) {
    console.error('执行升级失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 备份列表
router.get('/backups', authenticateToken, requireAdmin, (req, res) => {
  res.json({ backups: updater.listBackups() });
});

// 回滚到指定备份
router.post('/rollback', authenticateToken, requireAdmin, async (req, res) => {
  try {
    res.json(await updater.rollbackTo((req.body || {}).file || ''));
  } catch (error) {
    console.error('回滚失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 升级日志
router.get('/log', authenticateToken, requireAdmin, (req, res) => {
  res.json({ logs: updater.readLog(30) });
});

// 重启服务：仅在检测到 PM2 托管时允许（容器/裸机不做自杀式重启，只返回命令）
router.post('/restart', authenticateToken, requireAdmin, (req, res) => {
  const runtime = detectRuntime();
  if (!runtime.canSelfRestart) {
    return res.status(400).json({
      error: '当前部署方式不支持一键重启，请手动执行：' + runtime.restartCommand,
      runtime,
    });
  }
  const name = String(runtime.restartCommand || '').replace('pm2 restart ', '').trim();
  execFile('pm2', ['restart', name], { timeout: 20000 }, (error, stdout, stderr) => {
    if (error) {
      console.error('pm2 重启失败:', error.message, stderr || '');
      return res.status(500).json({ error: '重启失败：' + (stderr || error.message) });
    }
    res.json({ message: '服务正在重启，页面稍后会自动刷新', runtime });
  });
});

module.exports = router;
