/**
 * 主观题 AI 评阅（含手写作答照片识别）
 *
 * 这个模块从 routes/assignments.js 抽出来，因为它有 200 行且需要独立测试。
 *
 * 四条关键设计，都是踩过坑才定下来的：
 *
 * 1. **按题独立调用，不合并成一个 prompt**
 *    早先为省时间把一份作业的所有主观题塞进一次请求，代价有三：
 *      - AI 容易串题（第 2 题的评语写到第 3 题上）
 *      - 任何一题解析失败，整批都拿不到结果
 *      - 学生上传的作文照片无法对应到具体题目
 *    按题独立后每题的 prompt 只含这一题，判定更准、失败可单独重试。
 *    耗时变长无所谓——整个流程是后台异步的，学生本来就不用等。
 *
 * 2. **图片必须进 prompt**
 *    之前 image_url 只存库、不参与评阅，AI 根本看不到学生拍的照片，
 *    作文题拍照上传等于白做。现在按 paperScan.js 的做法把图片转 base64
 *    塞进 messages，并改用视觉模型。
 *
 * 3. **每题评完立刻写库**
 *    进程重启后，已评完的题不丢，剩下未评的可以续跑（靠 reviewed_at 判断）。
 *
 * 4. **不给兜底分数**
 *    原先 AI 少返回一题就按 60 分记，学生交白卷也是 60 分。
 *    现在失败就是失败，标记出来交老师人工批改。
 *
 * 5. **只评主观题**
 *    客观题（选择/判断/填空）本身有标准答案，提交时服务端已经规则判分，
 *    再送去 AI 是纯浪费：一份 10 选择 + 2 作文的作业会白打 10 次请求，
 *    又慢又费额度，还可能与标准答案给出不一致的判定。
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { db } = require('../config/database');
const { getAIConfig, isAIConfigured } = require('../config/ai');
const { getPrompt, fillTemplate } = require('../config/prompts');
const { grantReward } = require('./rewards');

/**
 * 客观题题型：这些题有唯一答案，提交时已由服务端按规则判好，不再送 AI。
 * 与 routes/assignments.js 的 isObjectiveType 必须保持一致。
 */
const OBJECTIVE_TYPES = ['choice_single', 'choice_multi', 'judgment', 'fill_blank'];
const OBJECTIVE_PLACEHOLDERS = OBJECTIVE_TYPES.map(() => '?').join(',');

/** 上传目录，必须与 routes/assignments.js 的 uploadsDir 一致 */
const uploadsDir = path.join(__dirname, '../../data/uploads');

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * 把 question_answers.image_url 解析成可读文件的绝对路径。
 *
 * image_url 存的是 `/uploads/xxx.jpg` 这种 URL 形式，而文件实际在
 * data/uploads/ 下；同时必须挡住路径穿越。
 * @returns {?{abs: string, mime: string}} 读不到返回 null
 */
function resolveAnswerImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  // 只取文件名，天然挡掉 ../ 之类的穿越尝试
  const name = path.basename(imageUrl);
  if (!name || name === '.' || name === '..') return null;
  const abs = path.join(uploadsDir, name);
  try {
    if (!fs.existsSync(abs)) return null;
    if (!fs.statSync(abs).isFile()) return null;
  } catch (e) {
    return null;
  }
  return { abs, mime: MIME_BY_EXT[(path.extname(name) || '').toLowerCase()] || 'image/jpeg' };
}

/** 从模型的回复里抠出 JSON（模型常包 ```json 或前后带说明文字） */
function parseAiJson(content) {
  const text = String(content || '');
  try {
    return JSON.parse(text);
  } catch (e) { /* 继续尝试其他提取方式 */ }

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch (e) { /* 落到正则 */ }
  }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) {
    try { return JSON.parse(obj[0]); } catch (e) { /* 实在解析不了 */ }
  }
  throw new Error('AI 返回内容里找不到 JSON');
}

/**
 * 评阅一道题。
 * @returns {Promise<{score:number, feedback:string, key_points:string[], improvements:string[]}>}
 * @throws 调用失败或返回无法解析时抛出，由调用方决定怎么处理
 */
async function reviewOneQuestion(qa, config, timeoutMs, subject) {
  const image = resolveAnswerImage(qa.image_url);
  const hasTextAnswer = String(qa.student_answer || '').trim().length > 0;

  const prompt = fillTemplate(getPrompt('review_subjective_batch'), {
    subject: subject || '',
    count: '1',
    questions_text: [
      `第 1 题（question_id=${qa.question_bank_id}）：`,
      `题目：${qa.question_content || ''}`,
      `参考答案：${qa.reference_answer || '无'}`,
      hasTextAnswer
        ? `学生文字答案：${qa.student_answer}`
        : (image ? '学生未输入文字，仅提交了手写作答照片' : '学生未作答'),
    ].join('\n'),
  });

  const content = [{ type: 'text', text: prompt }];
  if (image) {
    try {
      const b64 = fs.readFileSync(image.abs).toString('base64');
      content.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${b64}` } });
    } catch (e) {
      // 图片读不到就退回纯文字评阅，不让整题失败
      console.error(`[主观题评阅] 第 ${qa.question_bank_id} 题图片读取失败，降级为纯文字: ${e.message}`);
    }
  }

  // 有图时必须用视觉模型，否则多数模型会拒收 image_url
  const vision = String(config.ai_vision_model || '').trim();
  const hasImage = content.length > 1;
  const model = (hasImage || vision) && vision ? vision : config.ai_model;

  const resp = await axios.post(`${config.ai_base_url}/chat/completions`, {
    model,
    messages: [{ role: 'user', content }],
  }, {
    headers: { 'Authorization': `Bearer ${config.ai_api_key}`, 'Content-Type': 'application/json' },
    timeout: timeoutMs,
  });

  const parsed = parseAiJson(resp.data?.choices?.[0]?.message?.content);
  const item = Array.isArray(parsed) ? parsed[0] : (parsed.results || parsed.items || parsed);
  if (!item || typeof item !== 'object') throw new Error('AI 返回结构无法识别');

  return {
    score: Math.max(0, Math.min(100, parseInt(item.score, 10) || 0)),
    feedback: String(item.feedback || '').slice(0, 2000),
    key_points: Array.isArray(item.key_points) ? item.key_points.slice(0, 10).map(String) : [],
    improvements: Array.isArray(item.improvements) ? item.improvements.slice(0, 10).map(String) : [],
  };
}

/**
 * 评阅一份提交里的全部主观题。逐题独立调用，每题完成即写库。
 *
 * @param {number} submissionId
 * @param {number} assignmentId
 * @param {number} userId
 * @param {(info:object)=>void} [opts.onWrongQuestion] 答错题写入错题本的回调
 * @param {(p:object)=>void} [opts.onProgress] 进度回调，供日志/测试观察
 * @returns {Promise<{total:number, done:number, failed:number[], avgScore:number}>}
 */
async function reviewSubmission(submissionId, assignmentId, userId, opts = {}) {
  const submission = db.prepare(`
    SELECT s.*, a.max_exp, a.subject
    FROM submissions s
    JOIN assignments a ON s.assignment_id = a.id
    WHERE s.id = ?
  `).get(submissionId);

  if (!submission) return { total: 0, done: 0, failed: [], avgScore: 0 };
  // 已判完的不重复跑（重试时从这里续）
  if (submission.review_status === 'completed') {
    return { total: 0, done: 0, failed: [], avgScore: submission.total_score || 0, skipped: true };
  }

  // 只看主观题：客观题提交时就判好了，送 AI 既浪费额度又可能与标准答案不一致
  const rows = db.prepare(`
    SELECT qa.id, qa.question_bank_id, qa.student_answer, qa.image_url, qa.reviewed_at,
           qa.score, qa.is_correct,
           qb.content AS question_content, qb.answer AS reference_answer,
           qb.explanation, qb.analysis
    FROM question_answers qa
    JOIN question_bank qb ON qa.question_bank_id = qb.id
    WHERE qa.submission_id = ?
      AND qb.type NOT IN (${OBJECTIVE_PLACEHOLDERS})
    ORDER BY qa.id
  `).all(submissionId, ...OBJECTIVE_TYPES);

  if (rows.length === 0) {
    // 没有主观题可评（例如一份 mixed 作业里其实只放了选择题）。
    // 客观题提交时已经判好，这里把总分收尾即可，否则提交会永远卡在 pending。
    const { score } = computeFinalScore(submissionId, 0, 0);
    db.prepare("UPDATE submissions SET review_status = 'completed', total_score = ?, graded_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(score, submissionId);
    return { total: 0, done: 0, failed: [], avgScore: score };
  }

  db.prepare("UPDATE submissions SET review_status = 'reviewing' WHERE id = ?").run(submissionId);

  const config = getAIConfig();
  const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
  const aiReady = isAIConfigured(config);

  let done = 0;
  let scoreSum = 0;
  const failed = [];

  for (const qa of rows) {
    // 续跑：已评过的题不重复调 AI，省 token 也避免重复扣费
    if (qa.reviewed_at) {
      done += 1;
      scoreSum += qa.score || 0;
      // 进度回调也要走，否则续跑时前端进度条不动
      if (opts.onProgress) opts.onProgress({ done, total: rows.length, questionId: qa.question_bank_id, skipped: true });
      continue;
    }

    if (!aiReady) {
      // AI 没配置：不写兜底分，标记出来让老师人工批
      failed.push(qa.question_bank_id);
      markQuestionFailed(qa.id, 'AI 未配置，无法自动评阅');
      done += 1;
      if (opts.onProgress) opts.onProgress({ done, total: rows.length, questionId: qa.question_bank_id, failed: true });
      continue;
    }

    try {
      const r = await reviewOneQuestion(qa, config, timeoutMs, submission.subject);
      db.prepare(`
        UPDATE question_answers
        SET score = ?, max_score = 100, is_correct = ?, feedback = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        r.score,
        r.score >= 60 ? 1 : 0,
        JSON.stringify({ feedback: r.feedback, key_points: r.key_points, improvements: r.improvements }),
        qa.id
      );
      scoreSum += r.score;
      if (r.score < 60 && typeof opts.onWrongQuestion === 'function') {
        try {
          opts.onWrongQuestion({
            userId, assignmentId, questionId: qa.question_bank_id,
            wrongAnswer: qa.student_answer, correctAnswer: qa.reference_answer || '',
            analysis: qa.analysis || qa.explanation || '',
          });
        } catch (e) {
          console.error('[主观题评阅] 写错题本失败:', e.message);
        }
      }
    } catch (e) {
      // 单题失败不影响其它题，也绝不给兜底分
      console.error(`[主观题评阅] 第 ${qa.question_bank_id} 题失败: ${e.message}`);
      failed.push(qa.question_bank_id);
      markQuestionFailed(qa.id, e.message || 'AI 评阅失败');
    }

    done += 1;
    if (opts.onProgress) opts.onProgress({ done, total: rows.length, questionId: qa.question_bank_id });
  }

  /**
   * 总分口径统一为「每题等权」，把客观题的得分一起算进来：
   * 纯主观作业下它等价于原来的「各题平均分」，所以老行为不变；
   * 混合题型作业里客观题提交时就判好了，这里合到一起再结算。
   */
  const { score: totalScore } = computeFinalScore(submissionId, scoreSum, rows.length);
  const goldReward = Math.floor((totalScore / 100) * (submission.max_exp || 30));

  if (failed.length > 0) {
    // 有题没评出来：绝不能标 completed，否则学生会以为已经判完。
    // 留在 pending 让老师看到「待批改」，由人工补。
    db.prepare(`
      UPDATE submissions SET total_score = ?, review_status = 'pending' WHERE id = ?
    `).run(totalScore, submissionId);
    console.log(`[主观题评阅] submission=${submissionId} 完成 ${rows.length - failed.length}/${rows.length}，未评：${failed.join(', ')}`);
    return { total: rows.length, done, failed, avgScore: totalScore };
  }

  db.prepare(`
    UPDATE submissions
    SET total_score = ?, gold_reward = ?, review_status = 'completed',
        graded_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(totalScore, goldReward, submissionId);

  if (goldReward > 0) {
    try {
      grantReward(userId, {
        gold: goldReward,
        source: 'assignment_subjective',
        reason: `主观题作业评阅: ${assignmentId}`,
      });
    } catch (e) {
      console.error('[主观题评阅] 金币发放失败:', e.message);
    }
  }

  console.log(`[主观题评阅] submission=${submissionId} 全部完成，总分 ${totalScore}，金币 ${goldReward}`);
  return { total: rows.length, done, failed: [], avgScore: totalScore };
}

/**
 * 算这份提交的最终总分（0~100），口径是「每题等权」：
 *   - 客观题：答对记 1、答错记 0（提交时已由规则判好，落在 is_correct 上）
 *   - 主观题：把 0~100 的得分折算成 0~1
 *
 * 为什么不用「分数相加」：客观题每题满分是 100/总题数，主观题每题满分是 100，
 * 直接相加会把两种量纲混在一起。用得分率就没有这个问题。
 */
function computeFinalScore(submissionId, subjectiveScoreSum, subjectiveCount) {
  const obj = db.prepare(`
    SELECT COUNT(*) AS n, SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS c
    FROM question_answers qa
    JOIN question_bank qb ON qa.question_bank_id = qb.id
    WHERE qa.submission_id = ? AND qb.type IN (${OBJECTIVE_PLACEHOLDERS})
  `).get(submissionId, ...OBJECTIVE_TYPES);

  const objCount = (obj && obj.n) || 0;
  const objCorrect = (obj && obj.c) || 0;
  const totalCount = objCount + subjectiveCount;
  if (totalCount === 0) return { score: 0, totalCount: 0 };

  const ratioSum = objCorrect + (subjectiveScoreSum / 100);
  return { score: Math.round((ratioSum / totalCount) * 100), totalCount };
}

/** 标记某题评阅失败，把原因写进 feedback，前端点开就能看到 */
function markQuestionFailed(questionAnswerId, reason) {
  db.prepare(`
    UPDATE question_answers
    SET feedback = ?, reviewed_at = NULL
    WHERE id = ?
  `).run(JSON.stringify({ error: String(reason).slice(0, 300) }), questionAnswerId);
}

module.exports = { reviewSubmission, reviewOneQuestion, resolveAnswerImage, parseAiJson };
