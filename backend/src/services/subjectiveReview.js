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
 * 5. **只评需要 AI 评的题**
 *    选择题/判断题有唯一答案，提交时服务端已经规则判分，再送去 AI 是纯浪费：
 *    一份 10 选择 + 2 作文的作业会白打 10 次请求，又慢又费额度，
 *    还可能与标准答案给出不一致的判定。
 *
 *    【填空题为什么也在这里】填空题原本按逗号拆段逐空精确比对，代价是
 *    「北京 上海」「北京、上海」「牛顿, 第一定律」这类同样正确的写法全被判 0 分。
 *    现在改成由 AI 判断语义是否一致，与简答题同等待遇。
 *    相应地，AI 不可用或单题失败时必须有退路 —— 见下面的 ruleFallbackGrade：
 *    填空题仍有标准答案，退回规则比对能给出一个确定结果，绝不能让学生
 *    永远卡在「待评阅」。
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../config/database');
const { getAIConfig, isAIConfigured } = require('../config/ai');
const { chatCompletion } = require('./aiClient');
const { getPrompt, fillTemplate } = require('../config/prompts');
const { grantReward } = require('./rewards');
const { isAnswerCorrect, countFillBlankSlots } = require('../utils/answerCheck');
const studyStats = require('./studyStats');

/**
 * 「提交时已由服务端规则判好、不需要 AI」的题型。
 * 与 routes/assignments.js 的 isObjectiveType 必须保持一致。
 * 注意这里**不含 fill_blank**：填空题由 AI 评阅。
 */
const AUTO_GRADED_TYPES = ['choice_single', 'choice_multi', 'judgment'];
const AUTO_GRADED_PLACEHOLDERS = AUTO_GRADED_TYPES.map(() => '?').join(',');

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
 *
 * @param {object} qa 至少要有 question_bank_id / question_type / question_content /
 *                    reference_answer / student_answer；image_url 可选。
 *                    注意 image_url 为空时走纯文本模型——纸质卷扫描就是靠这点省下视觉模型开销。
 * @param {(usage:object)=>void} [onUsage] token 用量回调。aiClient 只归一化 usage、
 *                    不写 token_usage 表，记账由调用方负责；这里透出给需要统计的调用方。
 * @returns {Promise<{score:number, feedback:string, key_points:string[], improvements:string[]}>}
 * @throws 调用失败或返回无法解析时抛出，由调用方决定怎么处理
 */
async function reviewOneQuestion(qa, config, timeoutMs, subject, onUsage) {
  const image = resolveAnswerImage(qa.image_url);
  const hasTextAnswer = String(qa.student_answer || '').trim().length > 0;

  // 填空题也走这里。必须把题型和空位数告诉模型：否则它会照着「参考答案里的逗号」
  // 去逐字符比对，把「北京 上海」「北京、上海」判成错，正好是我们要消掉的那个老问题。
  const isFillBlank = String(qa.question_type || '').trim() === 'fill_blank';
  const typeHint = isFillBlank
    ? `填空题（题干共 ${countFillBlankSlots(qa.question_content)} 个空）`
    : (String(qa.question_type || '').trim() === 'composition' ? '作文题' : '简答题');

  const prompt = fillTemplate(getPrompt('review_subjective_batch'), {
    subject: subject || '',
    count: '1',
    questions_text: [
      `第 1 题（question_id=${qa.question_bank_id}）：`,
      `题型：${typeHint}`,
      `题目：${qa.question_content || ''}`,
      `参考答案：${qa.reference_answer || '无'}`,
      hasTextAnswer
        ? `学生文字答案：${qa.student_answer}`
        : (image ? '学生未输入文字，仅提交了手写作答照片' : '学生未作答'),
      ...(isFillBlank ? [
        '判分要求：本题是填空题，参考答案里多个答案用逗号分隔。学生可能用逗号、顿号或空格分隔，' +
        '也可能顺序不同、大小写不同、末尾多一个句号——这些都不要扣分。' +
        '只要每一空的含义与参考答案一致就给满分；有一处不符按偏离程度扣分；漏填的空视为未作答。',
      ] : []),
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

  // 统一走 aiClient：多模态 content 数组会在客户端按所选协议自动转换块类型
  // （chat 用 image_url，responses 用 input_image）
  const resp = await chatCompletion({
    config,
    model,
    messages: [{ role: 'user', content }],
    timeoutMs,
    label: '主观题评阅',
  });

  if (typeof onUsage === 'function') {
    try { onUsage(resp.usage || {}); } catch (e) { /* 记账失败不影响评阅结果 */ }
  }

  const parsed = parseAiJson(resp.content);
  /**
   * 取出这一题的结果对象。
   *
   * 【修掉的线上 bug】模板要求 AI 返回 {"results":[{...}]}，也就是 results
   * **是数组**。原实现 `parsed.results || parsed.items || parsed` 直接把数组
   * 当成结果对象用，于是 item.score 是 undefined、parseInt 得 NaN、
   * Math.min(100, NaN || 0) 恒等于 0 —— 于是每道 AI 题都判 0 分、
   * 评语一片空白，而日志里一句报错都没有。
   * 只有当模型把 results 写成单个对象时才碰巧正常，所以这个 bug 一直没被发现。
   * 现在无论顶层是数组、results 是数组还是对象，都能取到第一题的结果。
   */
  const rawItem = Array.isArray(parsed) ? parsed[0] : (parsed.results || parsed.items || parsed);
  const item = Array.isArray(rawItem) ? rawItem[0] : rawItem;
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
    SELECT s.*, a.max_exp, a.subject, a.max_attempts, a.assignment_type
    FROM submissions s
    JOIN assignments a ON s.assignment_id = a.id
    WHERE s.id = ?
  `).get(submissionId);

  if (!submission) return { total: 0, done: 0, failed: [], avgScore: 0 };
  // 已判完的不重复跑（重试时从这里续）
  if (submission.review_status === 'completed') {
    return { total: 0, done: 0, failed: [], avgScore: submission.total_score || 0, skipped: true };
  }

  /**
   * 只看需要 AI 评的题（简答 / 作文 / 填空）：选择、判断题提交时就判好了。
   *
   * 每题只取最近一轮作答（attempt_number 最大的一条）。重做会在同一题上追加记录，
   * 不过滤的话：旧的已评行会走下面的「续跑跳过」分支把旧分再累加一次，
   * 同一道题被算成两题，总分直接算歪。与提交侧 latestByQ 口径保持一致。
   */
  const rows = db.prepare(`
    SELECT qa.id, qa.question_bank_id, qa.student_answer, qa.image_url, qa.reviewed_at,
           qa.score, qa.is_correct,
           qb.type AS question_type,
           qb.content AS question_content, qb.answer AS reference_answer,
           qb.explanation, qb.analysis
    FROM question_answers qa
    JOIN question_bank qb ON qa.question_bank_id = qb.id
    WHERE qa.submission_id = ?
      AND qb.type NOT IN (${AUTO_GRADED_PLACEHOLDERS})
      AND qa.attempt_number = (
        SELECT MAX(qa2.attempt_number) FROM question_answers qa2
        WHERE qa2.submission_id = qa.submission_id AND qa2.question_bank_id = qa.question_bank_id
      )
    ORDER BY qa.id
  `).all(submissionId, ...AUTO_GRADED_TYPES);

  // 每题满分：与 routes/assignments.js 的 perQuestionMax 同一口径（100 / 作业题数）。
  // 不统一的话，同一份作业里 AI 题 max_score=100、选择题 max_score=100/N，
  // 老师改答案后按 Σscore/Σmax_score 重算的总分会跳变。
  const questionCount = db.prepare(
    'SELECT COUNT(*) AS n FROM assignment_questions WHERE assignment_id = ?'
  ).get(assignmentId)?.n || 1;
  const perQuestionMax = 100 / Math.max(1, questionCount);

  if (rows.length === 0) {
    // 没有需要 AI 评的题（例如一份 mixed 作业里其实只放了选择题）。
    // 这些题提交时已经判好，这里把总分收尾即可，否则提交会永远卡在 pending。
    const { score } = computeFinalScore(submissionId, 0, 0);
    finalizeSubmission(submission, submissionId, score, userId, assignmentId);
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
    /**
     * 续跑：已评过的题不重复调 AI，省 token 也避免重复扣费。
     *
     * 注意 scoreSum 累的是**原始百分制**（因为新入库的也是百分制，见下面的换算），
     * 而库里存的是按本题满分折算过的分。重做场景下这一行会被走到：
     * 直接 `scoreSum += qa.score` 会把「50 分满分题得 42.5 分」当成 42.5 分制，
     * 同一份作业里两种量纲相加，总分会凭空低一截（实测 85 分算成了 64 分）。
     * 所以这里要先按本题满分还原回百分制再累加。
     */
    if (qa.reviewed_at) {
      done += 1;
      const restored = (qa.max_score || perQuestionMax) > 0
        ? (qa.score / (qa.max_score || perQuestionMax)) * 100
        : 0;
      scoreSum += restored;
      // 进度回调也要走，否则续跑时前端进度条不动
      if (opts.onProgress) opts.onProgress({ done, total: rows.length, questionId: qa.question_bank_id, skipped: true });
      continue;
    }

    if (!aiReady) {
      // AI 没配置：简答/作文没有唯一答案，只能标记出来让老师人工批；
      // 填空题有标准答案，退回规则比对即可，绝不能让学生永远卡在「待评阅」。
      const fb = ruleFallbackGrade(qa, perQuestionMax);
      if (fb) {
        applyFallbackGrade(qa, fb, 'AI 未配置，已改为按参考答案自动比对', perQuestionMax);
        scoreSum += fb.score;
        recordGradedResult({ submission, userId, assignmentId, qa, isCorrect: fb.isCorrect });
        if (!fb.isCorrect) pushWrongQuestion(opts, { userId, assignmentId, qa });
      } else {
        failed.push(qa.question_bank_id);
        markQuestionFailed(qa.id, 'AI 未配置，无法自动评阅');
      }
      done += 1;
      if (opts.onProgress) opts.onProgress({ done, total: rows.length, questionId: qa.question_bank_id, failed: !fb });
      continue;
    }

    try {
      const r = await reviewOneQuestion(qa, config, timeoutMs, submission.subject);
      /**
       * AI 给的是 0~100 的百分制，本题的满分是 100/题数。
       * 必须换算后再入库，否则同一份作业里会出现「得分 85 / 满分 50」这种
       * 界面上看得见的荒唐数字（总分口径 computeFinalScore 用的是原始百分制，
       * 不受影响；但每题得分、得分率、排行榜全都要读 score）。
       */
      const scaledScore = Math.round((r.score / 100) * perQuestionMax * 100) / 100;
      db.prepare(`
        UPDATE question_answers
        SET score = ?, max_score = ?, is_correct = ?, feedback = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        scaledScore,
        perQuestionMax,
        r.score >= 60 ? 1 : 0,
        JSON.stringify({ feedback: r.feedback, key_points: r.key_points, improvements: r.improvements }),
        qa.id
      );
      scoreSum += r.score;
      const aiCorrect = r.score >= 60;
      recordGradedResult({ submission, userId, assignmentId, qa, isCorrect: aiCorrect });
      if (!aiCorrect) pushWrongQuestion(opts, { userId, assignmentId, qa });
    } catch (e) {
      // 单题失败不影响其它题。简答/作文不写兜底分（交老师人工批），
      // 填空题有标准答案，退回规则比对，保证学生拿得到一个确定结果。
      console.error(`[主观题评阅] 第 ${qa.question_bank_id} 题失败: ${e.message}`);
      const fb = ruleFallbackGrade(qa, perQuestionMax);
      if (fb) {
        applyFallbackGrade(qa, fb, `AI 评阅失败（${e.message || '未知原因'}），已改为按参考答案自动比对`, perQuestionMax);
        scoreSum += fb.score;
        recordGradedResult({ submission, userId, assignmentId, qa, isCorrect: fb.isCorrect });
        if (!fb.isCorrect) pushWrongQuestion(opts, { userId, assignmentId, qa });
      } else {
        failed.push(qa.question_bank_id);
        markQuestionFailed(qa.id, e.message || 'AI 评阅失败');
      }
    }

    done += 1;
    if (opts.onProgress) opts.onProgress({ done, total: rows.length, questionId: qa.question_bank_id });
  }

  /**
   * 总分口径统一为「每题等权」，把规则判好的题一起算进来：
   * 纯主观作业下它等价于原来的「各题平均分」，所以老行为不变；
   * 混合题型作业里选择/判断题提交时就判好了，这里合到一起再结算。
   */
  const { score: totalScore } = computeFinalScore(submissionId, scoreSum, rows.length);

  if (failed.length > 0) {
    // 有题没评出来：绝不能标 completed，否则学生会以为已经判完。
    // 留在 pending 让老师看到「待批改」，由人工补。
    db.prepare(`
      UPDATE submissions SET total_score = ?, review_status = 'pending' WHERE id = ?
    `).run(totalScore, submissionId);
    console.log(`[主观题评阅] submission=${submissionId} 完成 ${rows.length - failed.length}/${rows.length}，未评：${failed.join(', ')}`);
    return { total: rows.length, done, failed, avgScore: totalScore };
  }

  const settled = finalizeSubmission(submission, submissionId, totalScore, userId, assignmentId);

  console.log(`[主观题评阅] submission=${submissionId} 全部完成，总分 ${totalScore}，金币 ${settled.goldReward}，状态 ${settled.status}`);
  return { total: rows.length, done, failed: [], avgScore: totalScore };
}

/**
 * 答错时写错题本（评低于 60 分，或规则兜底判错）。
 * 抽出来是因为「AI 评出低分」和「AI 挂了退回规则判错」两条路都要写，漏一条
 * 学生就在错题本里看不到这道题。
 */
function pushWrongQuestion(opts, { userId, assignmentId, qa }) {
  if (typeof opts.onWrongQuestion !== 'function') return;
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

/**
 * 判完之后落学习数据（个人题库 + 知识点掌握度）。
 *
 * 这两件事原来只写在 routes/assignments.js 的同步判分分支里，
 * 于是所有异步评阅的题（简答、作文、填空）都不会写 —— 学生做了题，
 * 「个人题库」和「学习数据」里却查无此题。现在与规则判分共用 studyStats。
 */
function recordGradedResult({ submission, userId, assignmentId, qa, isCorrect }) {
  try {
    studyStats.recordQuestionResult({
      userId,
      questionBankId: qa.question_bank_id,
      assignmentId,
      assignmentType: submission.assignment_type || null,
      answer: qa.student_answer,
      isCorrect,
      source: 'online',
    });
  } catch (e) {
    console.error('[主观题评阅] 学习数据落地失败:', e.message);
  }
}

/**
 * AI 不可用时的退路：只有填空题能走。
 *
 * 简答/作文没有唯一答案，规则判不了（isAnswerCorrect 对它们直接返回 false），
 * 必须留给老师人工批；填空题有标准答案，用规则比对能给出一个确定结果，
 * 总好过让学生永远看到「待评阅」。
 */
function ruleFallbackGrade(qa, perQuestionMax) {
  if (String(qa.question_type || '').trim() !== 'fill_blank') return null;
  const hasStd = String(qa.reference_answer || '').trim().length > 0;
  if (!hasStd) return null;
  const correct = isAnswerCorrect('fill_blank', qa.student_answer, qa.reference_answer);
  return { score: correct ? perQuestionMax : 0, isCorrect: correct };
}

/** 把兜底判分结果写库，reviewed_at 照常写 —— 否则这题会被反复当成「待评」重试 */
function applyFallbackGrade(qa, fb, note, perQuestionMax) {
  db.prepare(`
    UPDATE question_answers
    SET score = ?, max_score = ?, is_correct = ?, feedback = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    fb.score,
    perQuestionMax,
    fb.isCorrect ? 1 : 0,
    JSON.stringify({ feedback: note }),
    qa.id
  );
}

/** 最近一轮里判错的题数（同一题多轮只算最后一次） */
function countWrongInLatestRound(submissionId) {
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM question_answers qa
    WHERE qa.submission_id = ?
      AND qa.is_correct = 0
      AND qa.attempt_number = (
        SELECT MAX(qa2.attempt_number) FROM question_answers qa2
        WHERE qa2.submission_id = qa.submission_id AND qa2.question_bank_id = qa.question_bank_id
      )
  `).get(submissionId)?.n || 0;
}

/**
 * 评阅结束后统一结算：总分、写状态、发金币。
 *
 * 状态这一处是新加的：之前异步评阅完只会把 review_status 置 completed，
 * submissions.status 一直停在 'submitted'，而重做入口（retry-questions）
 * 要求 status === 'retry_available' —— 结果填空题改成 AI 评阅后，
 * 学生答错了也永远拿不到重做按钮。
 *
 * 金币按差额结算：重做会再次跑一遍评阅，不做差额就会把同一份作业的金币
 * 反复发几遍（与 routes/assignments.js 纯客观题分支的算法保持一致）。
 */
function finalizeSubmission(submission, submissionId, totalScore, userId, assignmentId) {
  const maxAttempts = Number(submission.max_attempts) > 0 ? Number(submission.max_attempts) : 3;
  const usedAttempts = Number(submission.attempt_count) || 1;
  const wrongCount = countWrongInLatestRound(submissionId);
  const status = wrongCount > 0 && usedAttempts < maxAttempts ? 'retry_available' : 'completed';
  const goldReward = Math.floor((totalScore / 100) * (submission.max_exp || 30));
  const previousGold = Number(db.prepare('SELECT gold_reward FROM submissions WHERE id = ?').get(submissionId)?.gold_reward) || 0;

  db.prepare(`
    UPDATE submissions
    SET total_score = ?, gold_reward = ?, status = ?, review_status = 'completed',
        graded_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(totalScore, goldReward, status, submissionId);

  const goldDiff = goldReward - previousGold;
  if (goldDiff !== 0) {
    try {
      grantReward(userId, {
        gold: goldDiff,
        source: usedAttempts > 1 ? 'assignment_review_retry' : 'assignment_subjective',
        reason: usedAttempts > 1
          ? `作业重做评阅: ${assignmentId}（金币调整 ${goldDiff > 0 ? '+' : ''}${goldDiff}）`
          : `AI 评阅: ${assignmentId}`,
      });
    } catch (e) {
      console.error('[主观题评阅] 金币发放失败:', e.message);
    }
  }

  return { goldReward, goldDiff, status, wrongCount };
}

/**
 * 算这份提交的最终总分（0~100），口径是「每题等权」：
 *   - 规则判好的题（选择/判断）：答对记 1、答错记 0
 *   - AI 评阅的题（简答/作文/填空）：把 0~100 的得分折算成 0~1
 *
 * 为什么不用「分数相加」：每题满分统一是 100/总题数，AI 给的百分制得分
 * 与它不是一个量纲。用得分率就没有这个问题。
 *
 * 每题只统计最近一次作答 —— 重做会在同一题上追加记录，不过滤会把同一道题
 * 数成好几道，总分凭空变高。
 */
function computeFinalScore(submissionId, aiScoreSum, aiCount) {
  const auto = db.prepare(`
    SELECT COUNT(*) AS n, SUM(CASE WHEN qa.is_correct = 1 THEN 1 ELSE 0 END) AS c
    FROM question_answers qa
    JOIN question_bank qb ON qa.question_bank_id = qb.id
    WHERE qa.submission_id = ? AND qb.type IN (${AUTO_GRADED_PLACEHOLDERS})
      AND qa.attempt_number = (
        SELECT MAX(qa2.attempt_number) FROM question_answers qa2
        WHERE qa2.submission_id = qa.submission_id AND qa2.question_bank_id = qa.question_bank_id
      )
  `).get(submissionId, ...AUTO_GRADED_TYPES);

  const autoCount = (auto && auto.n) || 0;
  const autoCorrect = (auto && auto.c) || 0;
  const totalCount = autoCount + aiCount;
  if (totalCount === 0) return { score: 0, totalCount: 0 };

  const ratioSum = autoCorrect + (aiScoreSum / 100);
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

module.exports = {
  reviewSubmission,
  reviewOneQuestion,
  resolveAnswerImage,
  parseAiJson,
  computeFinalScore,
  ruleFallbackGrade,
};
