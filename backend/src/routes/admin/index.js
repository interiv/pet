/**
 * 管理后台路由聚合出口
 * 挂载顺序沿用拆分前 admin.js 中各分组的首次出现顺序，确保路由匹配优先级不变。
 */
const express = require('express');
const router = express.Router();

router.use('/', require('./teachers'));
router.use('/', require('./students'));
router.use('/', require('./classes'));
router.use('/', require('./announcements'));
router.use('/', require('./statistics'));
router.use('/', require('./settings'));
router.use('/', require('./monitor'));
router.use('/', require('./assignments'));
router.use('/', require('./maintenance'));
// 软件升级（挂 /api/admin/system/update）
router.use('/system/update', require('./update'));

module.exports = router;
