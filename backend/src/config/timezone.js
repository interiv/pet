const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

function getChinaDate() {
  const chinaTime = new Date(Date.now() + CHINA_OFFSET_MS);
  return chinaTime.toISOString().split('T')[0];
}

function getChinaYesterday() {
  const chinaTime = new Date(Date.now() + CHINA_OFFSET_MS - 86400000);
  return chinaTime.toISOString().split('T')[0];
}

module.exports = { getChinaDate, getChinaYesterday };
