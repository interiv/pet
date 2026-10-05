/**
 * 本地测试用的 mock AI 服务器
 *
 * 存在的原因：要验证「总耗时超过 60 秒仍不被切断」这个关键点，必须有一个
 * 能稳定慢下来的 AI。而真实豆包每次快慢不定、还要消耗额度，不适合做回归测试。
 *
 * 行为：模拟 OpenAI 兼容接口，按 prompt 里的题型返回对应数量的题目，
 *每个请求固定延迟 MOCK_DELAY_MS（默认 22000ms），让3 种题型并发的总耗时
 * 稳定落在 60~90 秒区间——正好覆盖原来必 504 的场景。
 */
const http = require('http');

const PORT = Number(process.env.MOCK_PORT || 8897);
const DELAY = Number(process.env.MOCK_DELAY_MS || 22000);
const PORT_MAP = {
  '单选': { type: 'choice_single' },
  '多选': { type: 'choice_multi' },
  '判断': { type: 'judgment' },
  '填空': { type: 'fill_blank' },
  '简答': { type: 'essay' },
  '作文': { type: 'composition' },
};

/**
 * 按题型造一道能通过 normalizeQuestion 校验的题目。
 * 字段名与格式必须严格对齐后端契约，否则会被当成「不合格题」剔除：
 *   content 必填且 >=4 字；explanation/hint/knowledge_point 可选
 *   choice_single 选项 >=2、答案是单个字母
 *   choice_multi  选项 >=2、答案归一化后 >=2 个字母
 *   judgment  不要选项、答案须是 true/false 白名单里的值
 *   fill_blank / essay 不要选项、答案非空
 */
function buildQuestion(type, i) {
  const base = {
    content: `mock 测试题第 ${i + 1} 道（${type}，用于验证异步任务与进度回报）`,
    explanation: '这是 mock 生成的解析。',
    hint: '',
    knowledge_point: 'mock 知识点',
  };
  switch (type) {
    case 'choice_single':
      return { ...base, options: ['选项甲', '选项乙', '选项丙', '选项丁'], answer: 'B' };
    case 'choice_multi':
      return { ...base, options: ['选项甲', '选项乙', '选项丙', '选项丁'], answer: 'A,C' };
    case 'judgment':
      return { ...base, options: null, answer: 'true' };
    case 'fill_blank':
      return { ...base, options: null, answer: '北京' };
    default:
      return { ...base, options: null, answer: '这是 mock 生成的参考答案，用于验证主观题能正常落库。' };
  }
}

function buildQuestions(prompt) {
  // 从 prompt 里认出是哪种题型，mock 只关心结构正确，不关心内容质量
  let type = 'choice_single';
  for (const [key, v] of Object.entries(PORT_MAP)) {
    if (prompt.includes(key)) { type = v.type; break; }
  }
  // 从 prompt 里读「本轮要求 N 道题」，读不到就按 2 道
  const m = prompt.match(/本轮要求\s*(\d+)\s*道/) || prompt.match(/(\d+)\s*道题/);
  const n = m ? Math.max(1, Math.min(10, parseInt(m[1], 10))) : 2;
  return { type, items: Array.from({ length: n }, (_, i) => buildQuestion(type, i)) };
}

/**
 * 纸质卷面判分的返回结构（与出题完全不同）。
 *
 * 关键点：question_id 必须是 prompt 里那条题目的真实 id，
 * 后端会按 qIds 过滤，对不上的直接丢掉——随便编 id 会导致
 * 「识别完成但一份结果都没有」，看不出是哪一步的问题。
 * 姓名则取名单里的第一个人，用来验证自动匹配这条链路。
 */
function buildPaperAnswer(prompt) {
  const qIds = [...prompt.matchAll(/ID:(\d+)/g)].map((m) => parseInt(m[1], 10)).filter(Number.isFinite);
  const nameMatch = prompt.match(/以下学生之一[：:]\s*([^\n]+)/) || prompt.match(/学生名单[：:]\s*([^\n]+)/);
  const firstName = nameMatch ? (nameMatch[1].split(/[、,，]/)[0] || '').trim() : '';
  return {
    student_name: firstName || 'mock学生',
    results: qIds.map((qid, i) => ({
      question_id: qid,
      recognized_answer: i % 2 === 0 ? 'A' : 'B',
      is_correct: i % 2 === 0,
      score: i % 2 === 0 ? 100 : 0,
      comment: i % 2 === 0 ? 'mock 判定为正确' : 'mock 判定为错误',
    })),
  };
}

/**
 * 主观题评阅的返回结构：单题、直接给分数与评语。
 * 故意不包在 results 数组里——真实的模型也常直接返回单个对象，
 * 这样能验证 parseAiJson 的兼容性。
 */
function buildReviewAnswer(prompt) {
  const qidMatch = prompt.match(/question_id=(\d+)/);
  const qid = qidMatch ? parseInt(qidMatch[1], 10) : 0;
  // 答了文字给 85 分，只拍照没文字给 70 分，全空给 0 分。
  // 「交白卷还给高分」正是这次要去掉的兜底行为，这里要能区分出来。
  const hasText = /学生文字答案：\s*\S/.test(prompt);
  const hasImageHint = /仅提交了手写作答照片/.test(prompt);
  let score = 0;
  if (hasText) score = 85;
  else if (hasImageHint) score = 70;
  return {
    question_id: qid,
    score,
    feedback: hasText ? 'mock：内容完整，结构清晰' : (hasImageHint ? 'mock：已从照片读出内容' : 'mock：未作答'),
    key_points: ['要点一', '要点二'],
    improvements: score >= 60 ? [] : ['需补充细节'],
  };
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not found' }));
  }

  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let prompt = '';
    let hasImage = false;
    try {
      const body = JSON.parse(raw);
      const msg = body.messages || [];
      // 兼容字符串与多段数组两种内容格式
      prompt = msg
        .map((m) => {
          if (typeof m.content === 'string') return m.content;
          // 视觉请求的 content 是数组，图片部分没有 text，要单独识别出来
          const parts = m.content || [];
          hasImage = parts.some((c) => c.type === 'image_url');
          return parts.map((c) => c.text || '').join(' ');
        })
        .join('\n');
    } catch { /* 忽略解析错误，用空 prompt */ }

    // 三种请求的返回结构完全不同，不能混用：
    //   出题question-gen  -> { questions: [...] }
    //   纸质卷面判分paper-judge -> { student_name, results: [{question_id,...}] }
    //   主观题评阅 subjective-review -> { score, feedback, key_points, improvements }
    // 最后一种通过 prompt 里的「参考答案」特征来识别。
    const isReview = /参考答案/.test(prompt) && /学生(文字答案|未作答|未输入文字)/.test(prompt);

    let content;
    let summary;
    if (isReview) {
      const review = buildReviewAnswer(prompt);
      content = JSON.stringify(review);
      summary = `评阅 ${review.score}分`;
    } else if (hasImage) {
      const paper = buildPaperAnswer(prompt);
      content = JSON.stringify(paper);
      summary = `${paper.student_name}/${paper.results.length}题`;
    } else {
      const gen = buildQuestions(prompt);
      content = JSON.stringify({ questions: gen.items });
      summary = `${gen.type} x${gen.items.length}`;
    }
    const kind = isReview ? 'subjective-review' : (hasImage ? 'paper-judge' : 'question-gen');

    console.log(`[mock] ${new Date().toISOString().slice(11, 19)} ${kind} (${prompt.length} 字符) -> ${summary}，${DELAY}ms 后返回`);

    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock-req-1',
        object: 'chat.completion',
        model: 'mock-e2e',
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      }));
      console.log(`[mock] ${new Date().toISOString().slice(11, 19)} 已返回 ${kind} -> ${summary}`);
    }, DELAY);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] AI 服务器已启动: http://127.0.0.1:${PORT}/chat/completions`);
  console.log(`[mock] 每个请求固定延迟 ${DELAY}ms，用于验证超过 60 秒的场景`);
});
