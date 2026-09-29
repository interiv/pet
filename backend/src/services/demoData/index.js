/**
 * 演示数据服务（统一入口）
 * 导出签名与拆分前完全一致：
 *   const { importDemoData, clearDemoData, getDemoStats } = require('../services/demoData');
 */
const { DEMO_PREFIX, DEMO_PASSWORD } = require('./_common');

module.exports = {
  importDemoData: require('./import'),
  clearDemoData: require('./clear'),
  getDemoStats: require('./stats'),
  DEMO_PREFIX,
  DEMO_PASSWORD,
};
