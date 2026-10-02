const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

function getChinaDate() {
  const chinaTime = new Date(Date.now() + CHINA_OFFSET_MS);
  return chinaTime.toISOString().split('T')[0];
}

function getChinaYesterday() {
  const chinaTime = new Date(Date.now() + CHINA_OFFSET_MS - 86400000);
  return chinaTime.toISOString().split('T')[0];
}

/** 中国时区下 n 天前的日期（YYYY-MM-DD）。统计窗口的起点必须用它，
 *  不能用 new Date().toISOString()——那是 UTC，早上 8 点前会少算「今天」。 */
function getChinaDateDaysAgo(days) {
  const chinaTime = new Date(Date.now() + CHINA_OFFSET_MS - days * 86400000);
  return chinaTime.toISOString().split('T')[0];
}

/** 中国时区下 n 天后的日期 */
function getChinaDateDaysLater(days) {
  const chinaTime = new Date(Date.now() + CHINA_OFFSET_MS + days * 86400000);
  return chinaTime.toISOString().split('T')[0];
}

/**
 * 统一解析统计时间窗口：优先绝对区间 date_from/date_to，缺省用相对 days。
 * @returns {{ start: string, end: string, days: number }}
 */
function resolveDateRange({ date_from, date_to, days, defaultDays = 7 } = {}) {
  const d = Math.max(0, parseInt(days) || defaultDays);
  const end = date_to || getChinaDate();
  const start = date_from || getChinaDateDaysAgo(d);
  return { start, end, days: d };
}

module.exports = { getChinaDate, getChinaYesterday, getChinaDateDaysAgo, getChinaDateDaysLater, resolveDateRange };
