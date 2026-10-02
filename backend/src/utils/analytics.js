/**
 * 统一分析层：学情统计的口径与 SQL 片段集中在这里，避免每个路由各写一遍。
 *
 * 背景（2026-10 修复）：
 *  1. 知识点学科过滤原先用 `JOIN question_bank qb ON qb.knowledge_point = kps.knowledge_point`，
 *     同一知识点名下有多道题时会**成倍放大** `SUM(total_attempts)`，正确率算错。
 *     改用 `EXISTS` 子查询做过滤，不产生行膨胀。
 *  2. 统计窗口起点原先用 `new Date().toISOString()`（UTC），写库却用北京时间，
 *     早上 8 点前会少算「今天」。统一走 resolveWindow。
 *  3. 知识点展示门槛原先是 `SUM(total_attempts) >= 3`，练习量少的学生（住校生、新生）
 *     所有知识点会被整体过滤，图表一片空白。放宽到 1，并允许调用方覆盖。
 */

const { resolveDateRange, getChinaDateDaysAgo, getChinaDateDaysLater } = require('../config/timezone');

/** 知识点进入统计的最小练习次数：1 = 有练习就展示 */
const MIN_POINT_ATTEMPTS = 1;
/** 掌握度判定阈值 */
const WEAK_ACCURACY = 60;
const MASTERED_ACCURACY = 80;
/** 判定掌握度所需的最小练习次数：1 次不作结论，2 次起才判薄弱/掌握。
 *  原先是 3，对新生和住校生过于苛刻——练习量本来就少，导致「薄弱数」恒为 0。 */
const MIN_ATTEMPTS_FOR_JUDGE = 2;

/** 知识点涨跌状态的中文标签 */
const STATUS_LABEL = {
  improving: '明显提升',
  declining: '出现下滑',
  consolidated: '已巩固',
  stable: '基本稳定',
  no_data: '尚未复习',
  new: '新增关注',
};

/**
 * 统一解析统计窗口，产出可直接拼进 WHERE 的片段。
 * @param {object} query req.query
 * @param {object} opts { defaultDays, alias, allowFuture }
 * @returns {{ start, end, days, dateClause, params }}
 */
function resolveWindow(query = {}, opts = {}) {
  const { defaultDays = 7, alias = '', allowFuture = false } = opts;
  const col = alias ? `${alias}.date` : 'date';
  const { date_from, date_to, days } = query;
  const range = resolveDateRange({ date_from, date_to, days, defaultDays });
  const end = allowFuture ? (date_to || getChinaDateDaysLater(1)) : range.end;
  return {
    start: range.start,
    end,
    days: range.days,
    dateClause: ` AND ${col} >= ? AND ${col} <= ?`,
    params: [range.start, end],
  };
}

/**
 * 知识点学科过滤片段（EXISTS 实现，不产生行膨胀）。
 * @param {string[]} subjects 为空则不按学科过滤
 * @param {string} kpAlias knowledge_point_stats 的表别名
 */
function subjectExistsFilter(subjects, kpAlias = 'kps') {
  const list = (subjects || []).filter(Boolean);
  if (list.length === 0) return { sql: '', params: [] };
  return {
    sql: ` AND EXISTS (
      SELECT 1 FROM question_bank qb
      WHERE qb.knowledge_point = ${kpAlias}.knowledge_point
        AND qb.knowledge_point IS NOT NULL AND qb.knowledge_point <> ''
        AND qb.subject IN (${list.map(() => '?').join(',')})
    )`,
    params: list,
  };
}

/** 正确率（%，两位小数）；分母为 0 返回 0 */
function accuracyPct(correct, total) {
  const t = Number(total) || 0;
  if (t <= 0) return 0;
  return Math.round((Number(correct) || 0) / t * 10000) / 100;
}

/**
 * 掌握度判定
 * @returns 'unknown' | 'weak' | 'normal' | 'mastered'
 */
function classifyMastery(accuracy, attempts, opts = {}) {
  const minForJudge = opts.minForJudge ?? MIN_ATTEMPTS_FOR_JUDGE;
  const weak = opts.weak ?? WEAK_ACCURACY;
  const mastered = opts.mastered ?? MASTERED_ACCURACY;
  if (!attempts || attempts < minForJudge) return 'unknown';
  if (accuracy < weak) return 'weak';
  if (accuracy >= mastered) return 'mastered';
  return 'normal';
}

/**
 * 「学生 × 知识点」聚合 SQL（作用于 knowledge_point_stats），已修正行膨胀问题。
 * @returns {{ sql, params }}
 */
function kpAggregateSql(opts = {}) {
  const {
    userId,
    dateClause = '',
    dateParams = [],
    subjectSql = '',
    subjectParams = [],
    minAttempts = MIN_POINT_ATTEMPTS,
    orderBy = 'accuracy ASC',
  } = opts;
  return {
    sql: `
      SELECT kps.knowledge_point,
             SUM(kps.total_attempts) AS total_attempts,
             SUM(kps.correct_attempts) AS correct_attempts,
             ROUND(CAST(SUM(kps.correct_attempts) AS REAL) / NULLIF(SUM(kps.total_attempts), 0) * 100, 2) AS accuracy
      FROM knowledge_point_stats kps
      WHERE kps.user_id = ?${dateClause}${subjectSql}
      GROUP BY kps.knowledge_point
      HAVING SUM(kps.total_attempts) >= ${Number(minAttempts) || 1}
      ORDER BY ${orderBy}
    `,
    params: [userId, ...dateParams, ...subjectParams],
  };
}

/** 给知识点聚合行补上掌握度标签，供前端直接渲染 */
function decoratePoints(rows, opts = {}) {
  return (rows || []).map((r) => ({
    ...r,
    accuracy: accuracyPct(r.correct_attempts ?? r.correct, r.total_attempts ?? r.attempts),
    mastery: classifyMastery(
      accuracyPct(r.correct_attempts ?? r.correct, r.total_attempts ?? r.attempts),
      r.total_attempts ?? r.attempts,
      opts
    ),
  }));
}

/**
 * 知识点涨跌对比：把「近期 vs 前期」的对比逻辑收敛到一处。
 * 原先只有 /review-effectiveness 一份实现，现支持任意两段区间与周/月粒度。
 *
 * @param {object} db better-sqlite3 实例
 * @param {object} opts { userId, subject, recentStart, baseStart, baseEnd, kpAlias }
 * @returns {{ points: Array, summary: object }}
 */
function compareWindows(db, opts = {}) {
  const { userId, subject, recentStart, recentEnd, baseStart, baseEnd } = opts;
  const subjectSql = subjectExistsFilter(subject ? [subject] : [], 'kps').sql;
  const subjectParams = subject ? [subject] : [];

  const rows = db.prepare(`
    SELECT kps.knowledge_point,
           SUM(CASE WHEN kps.date >= ? AND kps.date <= ? THEN kps.total_attempts ELSE 0 END) AS recent_attempts,
           SUM(CASE WHEN kps.date >= ? AND kps.date <= ? THEN kps.correct_attempts ELSE 0 END) AS recent_correct,
           SUM(CASE WHEN kps.date <  ? OR kps.date >  ? THEN kps.total_attempts ELSE 0 END) AS base_attempts,
           SUM(CASE WHEN kps.date <  ? OR kps.date >  ? THEN kps.correct_attempts ELSE 0 END) AS base_correct
    FROM knowledge_point_stats kps
    WHERE kps.user_id = ?${subjectSql}
    GROUP BY kps.knowledge_point
  `).all(
    recentStart, recentEnd || getChinaDateDaysLater(1),
    recentStart, recentEnd || getChinaDateDaysLater(1),
    recentStart, recentStart,
    baseStart, baseEnd || recentStart,
    userId,
    ...subjectParams
  );

  const points = [];
  for (const r of rows) {
    if (!r.recent_attempts && !r.base_attempts) continue;
    const recent = r.recent_attempts ? accuracyPct(r.recent_correct, r.recent_attempts) : null;
    const base = r.base_attempts ? accuracyPct(r.base_correct, r.base_attempts) : null;
    let status;
    let delta = null;
    if (recent === null) {
      status = 'no_data';           // 前期练过、近期没练 → 尚未复习
    } else if (base === null) {
      status = 'new';               // 近期新出现的知识点
    } else {
      delta = Math.round((recent - base) * 100) / 100;
      status = delta >= 10 ? 'improving'
        : delta <= -10 ? 'declining'
        : recent >= MASTERED_ACCURACY ? 'consolidated'
        : 'stable';
    }
    points.push({
      knowledge_point: r.knowledge_point,
      recent_attempts: r.recent_attempts,
      recent_accuracy: recent,
      base_attempts: r.base_attempts,
      base_accuracy: base,
      delta,
      status,
      status_label: STATUS_LABEL[status],
      was_weak: base !== null && base < WEAK_ACCURACY,
    });
  }

  points.sort((a, b) => {
    // 下滑的排最前，其次是原本薄弱但近期没练的
    const rank = (p) => (p.status === 'declining' ? 0 : p.status === 'no_data' && p.was_weak ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.delta === null) return 1;
    if (b.delta === null) return -1;
    return (b.delta || 0) - (a.delta || 0);
  });

  const summary = {
    total_tracked: points.filter((p) => p.status !== 'new').length,
    improving: points.filter((p) => p.status === 'improving').length,
    declining: points.filter((p) => p.status === 'declining').length,
    consolidated: points.filter((p) => p.status === 'consolidated').length,
    stable: points.filter((p) => p.status === 'stable').length,
    new_points: points.filter((p) => p.status === 'new').length,
    weak_not_reviewed: points.filter((p) => p.status === 'no_data' && p.was_weak).length,
  };

  return { points, summary };
}

module.exports = {
  MIN_POINT_ATTEMPTS,
  WEAK_ACCURACY,
  MASTERED_ACCURACY,
  MIN_ATTEMPTS_FOR_JUDGE,
  resolveWindow,
  subjectExistsFilter,
  accuracyPct,
  classifyMastery,
  kpAggregateSql,
  decoratePoints,
  compareWindows,
};
