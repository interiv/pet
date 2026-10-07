/**
 * 纸质作业扫描（批次制）
 *
 * 与旧的 ai-paper-judge-batch 并存：新流程把「上传」与「识别」拆成两步，
 * 且全部落库，好处有三：
 *   1. 逐张上传，不再把几十张图片塞进一个几 MB 的请求体
 *   2. 关掉弹窗 / 重启服务都不丢：下次打开能看到「上次传了 12/20，识别到第 8 组」
 *   3. 识别按组推进，进度真实，途中可取消（保留已识别部分）
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db } = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureFlags');
const { chatCompletion } = require('../services/aiClient');
const scanSvc = require('../services/paperScanService');

const router = express.Router();

const aiOff = requireFeature('ai_enabled', { message: 'AI 功能当前已关闭，请联系管理员' });
const aiJudgeOff = requireFeature('ai_paper_judge_enabled', { message: 'AI 批改当前已关闭，可改用手动登记' });
const paperUpOff = requireFeature('paper_upload_enabled', { message: '拍照上传当前已关闭，可改用手动登记' });

/** 扫描照片存到 data/uploads/paper-scan/，随 data 卷持久化 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 目录延后到真正上传时才建：系统被别人部署时这个目录本来就不存在，
    // 但不能因为建目录失败就让整个服务起不来。
    try {
      cb(null, scanSvc.scanImageDir());
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `p${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|webp|gif/i.test(path.extname(file.originalname) || '');
    cb(ok ? null : new Error('只支持 jpg / png / webp / gif 图片'), ok);
  },
});

/**
 * 一次请求同时收原图与小缩略图。
 * 分成两次请求会让「原图到了、缩略图没到」这种半成品状态出现，
 * 同一次写盘、同一次 markUploaded，要么都有要么都没有。
 * thumb 是可选字段：老版本前端、或缩略图生成失败时只有 file。
 */
const uploadImage = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumb', maxCount: 1 },
]);

/** 取出路径里的作业 id 并校验是班主任/管理员，且作业属于他 */
function requireAssignmentOwner(req, res, next) {
  const assignmentId = parseInt(req.params.id, 10);
  if (!Number.isFinite(assignmentId)) {
    return res.status(400).json({ error: '作业 id 无效' });
  }
  const assignment = db.prepare('SELECT id, title, subject, class_id, teacher_id FROM assignments WHERE id = ?').get(assignmentId);
  if (!assignment) return res.status(404).json({ error: '作业不存在' });

  if (req.user.role !== 'admin') {
    const owns = db.prepare('SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ?')
      .get(req.user.userId, assignment.class_id);
    if (!owns && assignment.teacher_id !== req.user.userId) {
      return res.status(403).json({ error: '你不是该班老师，无法登记纸质作业' });
    }
  }
  req.assignment = assignment;
  next();
}

/** 取出批次并校验归属（老师只能看自己的批次，管理员不受限） */
function loadBatch(req, res, next) {
  const batchId = parseInt(req.params.batchId, 10);
  const batch = scanSvc.getBatch(batchId);
  if (!batch) return res.status(404).json({ error: '批次不存在或已被删除' });
  if (batch.assignment_id !== req.assignment.id) {
    return res.status(400).json({ error: '批次与作业不匹配' });
  }
  if (req.user.role !== 'admin' && batch.user_id !== req.user.userId) {
    return res.status(403).json({ error: '只能操作自己创建的扫描批次' });
  }
  req.batch = batch;
  next();
}
// ===== 批次 =====

/** 新建批次。group_size = 每人几张，后续可改 */
router.post('/:id/paper-scan/batches', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, (req, res) => {
  try {
    // student_id 只有单人登记会传；批量扫描不传（一个批次装着全班）
    let studentId = req.body?.student_id ? parseInt(req.body.student_id, 10) : null;
    if (studentId !== null) {
      if (!Number.isFinite(studentId)) {
        return res.status(400).json({ error: '学生 id 无效' });
      }
      // 必须是这份作业所在班级的学生，否则会把别班学生挂进来
      const inClass = db.prepare(
        "SELECT id FROM users WHERE id = ? AND class_id = ? AND role = 'student'"
      ).get(studentId, req.assignment.class_id);
      if (!inClass) return res.status(400).json({ error: '该学生不在本班' });
    }

    // 单人登记：优先复用该学生未完成的批次，避免每次切人都新建一批空批次
    if (studentId !== null) {
      const existing = scanSvc.findStudentBatch(
        req.assignment.id, studentId, req.user.userId, req.user.role === 'admin'
      );
      if (existing) {
        return res.json({ batch: scanSvc.toPublicBatch(existing), reused: true });
      }
    }

    const batch = scanSvc.createBatch({
      assignmentId: req.assignment.id,
      userId: req.user.userId,
      title: req.assignment.title,
      subject: req.assignment.subject,
      groupSize: req.body?.group_size,
      studentId,
    });
    res.json({ batch: scanSvc.toPublicBatch(batch), reused: false });
  } catch (e) {
    console.error('创建扫描批次失败:', e.message);
    res.status(500).json({ error: '创建批次失败' });
  }
});

/**
 * 标记批次已登记（成绩已写入 submissions）。
 *
 * 登记后**不删批次**：老师可能发现某题判错了要改，
 * 保留批次才能看到「已登记」标记、复用已识别的结果。
 * 想彻底清掉照片和记录，让老师点「丢弃照片」即可。
 */
router.post('/:id/paper-scan/batches/:batchId/registered', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  try {
    scanSvc.markRegistered(req.batch.id);
    res.json({ message: '已标记为登记完成', batch: scanSvc.toPublicBatch(scanSvc.getBatch(req.batch.id)) });
  } catch (e) {
    console.error('标记登记状态失败:', e.message);
    res.status(500).json({ error: '标记失败' });
  }
});

/** 单人登记：各学生的扫描进度汇总。
 *
 * 左侧学生列表要显示「谁传了几张 / 谁已识别 / 谁已登记」，
 * 没有这个接口就只能逐个学生去查批次。
 */
router.get('/:id/paper-scan/student-progress', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, (req, res) => {
  try {
    const map = scanSvc.studentProgressMap(req.assignment.id, req.user.userId, req.user.role === 'admin');
    // 转成数组并带上 student_id，前端直接遍历
    const list = Object.keys(map).map((sid) => ({ student_id: Number(sid), ...map[sid] }));
    res.json({ progress: list });
  } catch (e) {
    console.error('读取学生扫描进度失败:', e.message);
    res.status(500).json({ error: '读取进度失败' });
  }
});

/** 历史批次列表：下次打开靠它恢复「上次传到哪、识别到哪」 */
router.get('/:id/paper-scan/batches', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, (req, res) => {
  try {
    res.json({ batches: scanSvc.listBatches(req.assignment.id, req.user.userId, req.user.role === 'admin') });
  } catch (e) {
    console.error('读取批次列表失败:', e.message);
    res.status(500).json({ error: '读取批次失败' });
  }
});

/** 批次详情（含每张的上传状态与识别结果），前端轮询的就是它 */
router.get('/:id/paper-scan/batches/:batchId', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  res.json({ batch: scanSvc.toPublicBatch(scanSvc.getBatch(req.batch.id)) });
});

/** 改「每人几张」，自动重分组 */
router.post('/:id/paper-scan/batches/:batchId/group-size', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  try {
    scanSvc.regroup(req.batch.id, req.body?.group_size);
    res.json({ batch: scanSvc.toPublicBatch(scanSvc.getBatch(req.batch.id)) });
  } catch (e) {
    console.error('调整分组失败:', e.message);
    res.status(500).json({ error: '调整分组失败' });
  }
});

/** 调整顺序：传新的图片 id 顺序 */
router.post('/:id/paper-scan/batches/:batchId/reorder', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  try {
    scanSvc.reorder(req.batch.id, req.body?.image_ids);
    res.json({ batch: scanSvc.toPublicBatch(scanSvc.getBatch(req.batch.id)) });
  } catch (e) {
    console.error('调整顺序失败:', e.message);
    res.status(500).json({ error: '调整顺序失败' });
  }
});

/** 删除整批（含已上传的照片文件） */
router.delete('/:id/paper-scan/batches/:batchId', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  try {
    if (req.batch.scan_status === 'running') {
      return res.status(409).json({ error: '识别正在进行中，请先取消再删除' });
    }
    scanSvc.deleteBatch(req.batch.id);
    res.json({ message: '批次已删除' });
  } catch (e) {
    console.error('删除批次失败:', e.message);
    res.status(500).json({ error: '删除批次失败' });
  }
});

// ===== 照片上传（逐张） =====

/**
 * 登记一张照片的「占位」——只记元信息，不传文件。
 * 前端可以先把 20 张全部登记完，再逐张上传内容；
 * 这样中途关掉，服务端也知道「还差哪几张」。
 */
router.post('/:id/paper-scan/batches/:batchId/images', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, paperUpOff, (req, res) => {
  try {
    const current = scanSvc.listImages(req.batch.id).length;
    if (current >= scanSvc.MAX_IMAGES) {
      return res.status(400).json({ error: `一个批次最多 ${scanSvc.MAX_IMAGES} 张照片` });
    }
    const imageId = scanSvc.addImagePlaceholder(req.batch.id, {
      seq: current,
      fileName: req.body?.file_name || '',
      fileSize: req.body?.file_size || 0,
      mimeType: req.body?.mime_type || '',
    });
    res.json({ image_id: imageId, batch: scanSvc.toPublicBatch(scanSvc.getBatch(req.batch.id)) });
  } catch (e) {
    console.error('登记照片失败:', e.message);
    res.status(500).json({ error: '登记照片失败' });
  }
});

/** 上传某张照片的文件内容（单张，multipart） */
router.post('/:id/paper-scan/batches/:batchId/images/:imageId/file', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, paperUpOff, (req, res) => {
  uploadImage(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? '单张照片不能超过 8MB'
        : (err.message || '上传失败');
      return res.status(400).json({ error: msg });
    }
    const file = (req.files && req.files.file && req.files.file[0]) || null;
    const thumb = (req.files && req.files.thumb && req.files.thumb[0]) || null;
    if (!file) return res.status(400).json({ error: '没有收到文件' });

    const imageId = parseInt(req.params.imageId, 10);
    const image = db.prepare('SELECT * FROM paper_scan_images WHERE id = ? AND batch_id = ?').get(imageId, req.batch.id);
    if (!image) {
      // 记录不存在时两个文件都要清掉，只删原图会留下一个没主的缩略图
      [file, thumb].forEach((f) => { if (f) { try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ } } });
      return res.status(404).json({ error: '照片记录不存在' });
    }

    scanSvc.markUploaded(imageId, {
      filePath: file.filename,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      // 缩略图是可选字段：前端生成失败时传不上来，网格会回退去拉原图
      thumbPath: thumb ? thumb.filename : '',
      thumbSize: thumb ? thumb.size : 0,
    });
    res.json({ image_id: imageId, batch: scanSvc.toPublicBatch(scanSvc.getBatch(req.batch.id)) });
  });
});

/**
 * 读取某张照片的原图（放大核对用）
 *
 * 没有它的话，新流程上传完就看不到任何东西——上传接口只往磁盘写文件，
 * 前端拿到的只有 file_name，无法渲染<img>。旧流程把图片塞在请求体里、
 * 前端自己存着 dataURL，所以不需要这个接口。
 *
 * 权限沿用 loadBatch：只有该作业的班主任/管理员、且能操作这个批次的人能看。
 * 照片本身是学生的作答，不做公开访问。
 *
 * 注意：网格里的几十像素小图**不要**用这个接口，走 /thumb——
 * 一张原图几百 KB，一个班就是十几 MB，纯粹是白下的。
 */
router.get('/:id/paper-scan/batches/:batchId/images/:imageId/file', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  const imageId = parseInt(req.params.imageId, 10);
  const image = db.prepare('SELECT * FROM paper_scan_images WHERE id = ? AND batch_id = ?').get(imageId, req.batch.id);
  if (!image) return res.status(404).json({ error: '照片不存在' });
  if (!image.file_path) return res.status(404).json({ error: '照片尚未上传' });

  const abs = path.join(scanSvc.scanImageDir(), path.basename(image.file_path));
  // file_path 来自数据库，这里再用 basename 兜一次：
  // 万一被写入了 ../ 之类的路径，也不会读到批次目录以外的文件
  if (!fs.existsSync(abs)) {
    return res.status(404).json({ error: '照片文件已丢失，请重新上传' });
  }

  res.type(image.mime_type || 'image/jpeg');
  // 内容不变可缓存；文件名带时间戳+随机数，内容变了 URL 也会变
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(abs);
});

/**
 * 读取某张照片的小缩略图——列表与网格用这个，不要用 /file。
 *
 * 为什么要单独一个接口：网格每格只有几十像素，原图动辄几百 KB，
 * 扫一个班要白下十几 MB，慢速网络下就是几十秒的空白格。
 * 缩略图是前端上传时顺手生成的（长边 320，约十几 KB），随原图一起传上来。
 *
 * 老照片（这个改造之前上传的）没有缩略图，回退发原图——功能不退化，
 * 只是那几张仍然偏大，重传一次即可变小。
 */
router.get('/:id/paper-scan/batches/:batchId/images/:imageId/thumb', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  const imageId = parseInt(req.params.imageId, 10);
  const image = db.prepare('SELECT * FROM paper_scan_images WHERE id = ? AND batch_id = ?').get(imageId, req.batch.id);
  if (!image) return res.status(404).json({ error: '照片不存在' });

  const hasThumb = !!image.thumb_path;
  const name = hasThumb ? image.thumb_path : image.file_path;
  if (!name) return res.status(404).json({ error: '照片尚未上传' });

  // name 来自数据库，这里再用 basename 兜一次，防止读到批次目录以外的文件
  const abs = path.join(scanSvc.scanImageDir(), path.basename(name));
  if (!fs.existsSync(abs)) {
    return res.status(404).json({ error: '照片文件已丢失，请重新上传' });
  }

  res.type(hasThumb ? 'image/jpeg' : (image.mime_type || 'image/jpeg'));
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(abs);
});

/** 删掉单张照片（同时删服务器上的文件） */
router.delete('/:id/paper-scan/batches/:batchId/images/:imageId', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  try {
    const imageId = parseInt(req.params.imageId, 10);
    const image = db.prepare('SELECT id FROM paper_scan_images WHERE id = ? AND batch_id = ?').get(imageId, req.batch.id);
    if (!image) return res.status(404).json({ error: '照片不存在' });
    if (req.batch.scan_status === 'running') {
      return res.status(409).json({ error: '识别正在进行中，无法增删照片' });
    }
    scanSvc.deleteImage(imageId);
    res.json({ batch: scanSvc.toPublicBatch(scanSvc.getBatch(req.batch.id)) });
  } catch (e) {
    console.error('删除照片失败:', e.message);
    res.status(500).json({ error: '删除照片失败' });
  }
});

// ===== 识别（按组调用，真实进度，可取消） =====

const { getPrompt, fillTemplate } = require('../config/prompts');
const { getAIConfig, isAIConfigured } = require('../config/ai');
const { getChinaDate } = require('../config/timezone');

/**
 * 识别一个批次：按「组」逐组调用 AI。
 *
 * 为什么按组而不是一次全丢进去：
 *   - 一次全丢：输出容易超 max_tokens 被截断，且只能假进度；
 *   - 逐张调用：同一个人的几页卷面被拆散，AI 认不出完整一份；
 *   - 按组调用：一份卷子的几张照片一起给模型，既能合并识别，
 *     又能在每组完成后立刻更新真实进度，中途还能取消。
 */
async function runScanBatch(batchId, userId) {
  const batch = scanSvc.getBatch(batchId);
  if (!batch) throw new Error('批次不存在');

  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(batch.assignment_id);
  if (!assignment) throw new Error('作业不存在');

  const questions = db.prepare(`
    SELECT qb.id, qb.type, qb.content, qb.answer
    FROM assignment_questions aq
    JOIN question_bank qb ON aq.question_bank_id = qb.id
    WHERE aq.assignment_id = ?
    ORDER BY aq.sort_order
  `).all(batch.assignment_id);
  if (questions.length === 0) throw new Error('该作业没有题目，无法识别');

  const images = scanSvc.listImages(batchId).filter((i) => !!i.file_path);
  if (images.length === 0) throw new Error('还没有上传任何照片');

  const config = getAIConfig();
  if (!isAIConfigured(config)) throw new Error('AI 配置未完成，请联系管理员');
  const visionModel = (config.ai_vision_model && String(config.ai_vision_model).trim()) || config.ai_model;

  const students = db.prepare(
    `SELECT id, username, real_name FROM users WHERE class_id = ? AND role = 'student' AND status = 'active'`
  ).all(assignment.class_id);

  const groupMap = new Map();
  for (const img of images) {
    const g = img.group_no || 0;
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g).push(img);
  }
  const groups = [...groupMap.entries()].sort((a, b) => a[0] - b[0]);

  const tLabel = (t) => ({ choice_single: '单选题', choice_multi: '多选题', judgment: '判断题', fill_blank: '填空题', essay: '简答/主观题' }[t] || t);
  const questionList = questions.map((q, i) =>
    `ID:${q.id} 第${i + 1}题[${tLabel(q.type)}] 题目：${String(q.content).slice(0, 80)} 参考答案：${q.answer}`
  ).join('\n');
  const nameList = students.map((s) => s.real_name || s.username).join('、') || '（未获取到名单）';

  const timeoutMs = (parseInt(config.ai_timeout) || 300) * 1000;
  const maxRow = db.prepare("SELECT value FROM settings WHERE key = 'max_tokens_per_generation'").get();
  const maxTokens = parseInt(maxRow && maxRow.value) || 18000;

  scanSvc.markScanRunning(batchId, visionModel);

  const papers = [];
  let scanned = 0;
  let cancelled = false;
  const usageSum = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const startAll = Date.now();

  for (const [groupNo, groupImages] of groups) {
    // 取消检查：老师中途点了取消就到此为止，已识别的部分保留
    if (scanSvc.isScanCancelled(batchId)) { cancelled = true; break; }

    // 读图失败不能静默跳过：否则整组被跳过，表现为「识别 0 组」且毫无线索
    const dataUrls = [];
    for (const g of groupImages) {
      try {
        dataUrls.push('data:image/jpeg;base64,' + fs.readFileSync(scanSvc.imageAbsolutePath(g.file_path)).toString('base64'));
      } catch (e) {
        console.error('[paper-scan] 图片读取失败 image=' + g.id + ' path=' + g.file_path + ':', e.message);
      }
    }
    if (dataUrls.length === 0) {
      console.warn('[paper-scan] 第' + groupNo + '组图片全部读不到，跳过');
      scanned += 1;
      scanSvc.reportProgress(batchId, scanned, groups.length);
      continue;
    }

    // 单组只有一份卷面，明确告诉模型「这几张是同一个人的」
    const prompt = fillTemplate(getPrompt('judge_paper_batch'), {
      subject: assignment.subject || '',
      question_list: questionList,
      count: String(questions.length),
      image_count: String(dataUrls.length),
      name_list: nameList,
    });
    const content = [
      { type: 'text', text: '注意：本次只发来一份卷子（' + dataUrls.length + ' 张照片，属于同一个学生），请只识别这一份，不要尝试分组。\n\n' + prompt },
      ...dataUrls.map((u) => ({ type: 'image_url', image_url: { url: u } })),
    ];

    try {
      const reply = await chatCompletion({
        config,
        model: visionModel,
        messages: [{ role: 'user', content }],
        maxTokens,
        timeoutMs,
        label: '纸质卷面判分',
      });

      // usage 已由 aiClient 归一化，两种协议的记账字段一致
      const u = reply.usage || {};
      usageSum.prompt_tokens += u.prompt_tokens || 0;
      usageSum.completion_tokens += u.completion_tokens || 0;
      usageSum.total_tokens += u.total_tokens || 0;

      const one = parsePapers(reply.content || '')[0];
      if (one) {
        const qIds = new Set(questions.map((q) => q.id));
        const results = (one.results || []).filter((r) => qIds.has(parseInt(r.question_id, 10))).map((r) => ({
          question_id: parseInt(r.question_id, 10),
          recognized_answer: String(r.recognized_answer == null ? '' : r.recognized_answer),
          is_correct: !!r.is_correct,
          score: Math.max(0, Math.min(100, parseInt(r.score, 10) || 0)),
          comment: String(r.comment || ''),
        }));
        if (results.length > 0) {
          const rawName = String(one.student_name || '').trim();
          const matched = matchStudent(rawName, students);
          papers.push({
            group_no: groupNo,
            image_ids: groupImages.map((g) => g.id),
            student_id: matched ? matched.id : null,
            student_name: matched ? (matched.real_name || matched.username) : rawName,
            raw_name: rawName,
            matched: !!matched,
            results,
          });
          scanSvc.attachStudentToGroup(batchId, groupNo, matched ? matched.id : null, rawName);
        }
      }
    } catch (e) {
      // 单组失败不影响其它组，该组留空由老师手动指派
      console.error('[paper-scan] 第' + groupNo + '组识别失败:', e.message);
      papers.push({
        group_no: groupNo, image_ids: groupImages.map((g) => g.id),
        student_id: null, student_name: '', raw_name: '', matched: false, results: [],
        error: e.code === 'ECONNABORTED' ? 'AI识别超时' : (e.message || '识别失败'),
      });
    }

    scanned += 1;
    scanSvc.reportProgress(batchId, scanned, groups.length);
  }

  try {
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='token_usage'").get();
    if (hasTable && usageSum.total_tokens > 0) {
      db.prepare("INSERT INTO token_usage (user_id, date, prompt_tokens, completion_tokens, total_tokens, model, subject, topic, question_type, question_count, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(userId, getChinaDate(), usageSum.prompt_tokens, usageSum.completion_tokens, usageSum.total_tokens,
          visionModel, assignment.subject || '纸质识别', '纸质扫描逐组识别', assignment.question_type, questions.length * images.length, Date.now() - startAll);
    }
  } catch (e) { /* 统计失败不影响结果 */ }

  if (cancelled) {
    // 取消不是回滚：已识别的部分保留，老师可以先登记这部分
    scanSvc.markScanCancelled(batchId, scanned);
    return { status: 'cancelled', scanned_groups: scanned, total_groups: groups.length };
  }

  scanSvc.markScanDone(batchId, { papers, model: visionModel }, visionModel);
  return { status: 'done', papers: papers.length, total_groups: groups.length };
}

/** 从模型返回里取出 papers 数组（容忍 markdown 包裹与前后废话） */
function parsePapers(content) {
  const text = String(content || '').trim();
  if (!text) return [];
  const tryParse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  let obj = tryParse(text);
  if (!obj) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) obj = tryParse(m[0]);
  }
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.papers)) return obj.papers;
  if (Array.isArray(obj.results)) return [{ student_name: obj.student_name, results: obj.results }];
  return [];
}

/** 卷面姓名匹配本班学生：真实姓名 → 用户名 → 唯一包含 */
function matchStudent(rawName, students) {
  const name = String(rawName || '').trim();
  if (!name || name === '(未识别)') return null;
  const norm = (s) => String(s || '').replace(/\s+/g, '').trim();
  const target = norm(name);
  let hit = students.find((s) => norm(s.real_name) === target);
  if (hit) return hit;
  hit = students.find((s) => norm(s.username) === target);
  if (hit) return hit;
  const contains = students.filter((s) => {
    const rn = norm(s.real_name);
    return rn && (target.includes(rn) || rn.includes(target));
  });
  return contains.length === 1 ? contains[0] : null;
}

// ===== 启动 / 取消识别 =====

/**
 * 开始识别。立即返回，识别在后台跑：
 * 老师可以关掉弹窗去做别的，下次打开 GET 批次详情就能看到进度与结果。
 */
router.post('/:id/paper-scan/batches/:batchId/start', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, aiOff, aiJudgeOff, (req, res) => {
  const batch = req.batch;
  if (batch.scan_status === 'running') {
    return res.status(409).json({ error: '识别正在进行中' });
  }
  const uploaded = scanSvc.countImages(batch.id);
  if (uploaded === 0) {
    return res.status(400).json({ error: '请先上传照片' });
  }
  const pending = scanSvc.listImages(batch.id).filter((i) => !i.file_path).length;
  if (pending > 0) {
    return res.status(400).json({ error: `还有 ${pending} 张照片未上传，请先补齐或删掉它们再开始识别` });
  }

  // 重新识别时先清空上次结果；续跑（cancelled）时保留已识别部分
  if (req.body?.restart === 'all' || batch.scan_status === 'done') {
    scanSvc.clearScanResult(batch.id);
    // 成绩要重新判，登记标记必须一起撤销。
    // 否则会出现「左边显示已登记、结果却是重新判的」这种自相矛盾的状态。
    if (batch.registered_at) scanSvc.markRegistered(batch.id, true);
  }

  res.json({ message: '已开始识别，可关闭弹窗，稍后回来看结果', batch: scanSvc.toPublicBatch(scanSvc.getBatch(batch.id)) });

  // 后台执行，不占用连接
  setImmediate(async () => {
    try {
      await runScanBatch(batch.id, req.user.userId);
    } catch (e) {
      // 这里必须打出来：否则后台失败在日志里完全看不见，
      // 表现为「识别瞬间结束、0 组结果」，极难排查。
      console.error('[paper-scan] 批次识别失败 batch=' + batch.id + ':', e && e.stack ? e.stack : e);
      scanSvc.markScanFailed(batch.id, (e && e.message) || '识别失败');
    }
  });
});

/** 取消识别：停止后续分组，已识别部分保留（不是回滚，因为还没登记） */
router.post('/:id/paper-scan/batches/:batchId/cancel', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  try {
    if (req.batch.scan_status !== 'running') {
      return res.status(400).json({ error: '当前没有正在进行的识别' });
    }
    scanSvc.markScanCancelled(req.batch.id, req.batch.scanned_groups || 0);
    res.json({ message: '已停止识别，已识别出的部分仍然保留', batch: scanSvc.toPublicBatch(scanSvc.getBatch(req.batch.id)) });
  } catch (e) {
    console.error('取消识别失败:', e.message);
    res.status(500).json({ error: '取消失败' });
  }
});

/** 续跑：只识别还没成功的组，已识别的结果保留 */
router.post('/:id/paper-scan/batches/:batchId/resume', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, aiOff, aiJudgeOff, (req, res) => {
  const batch = req.batch;
  if (batch.scan_status === 'running') return res.status(409).json({ error: '识别正在进行中' });
  const uploaded = scanSvc.countImages(batch.id);
  if (uploaded === 0) return res.status(400).json({ error: '请先上传照片' });

  res.json({ message: '已开始续跑', batch: scanSvc.toPublicBatch(scanSvc.getBatch(batch.id)) });
  setImmediate(async () => {
    try {
      await runScanBatch(batch.id, req.user.userId);
    } catch (e) {
      console.error('[paper-scan] 续跑失败:', e.message);
      scanSvc.markScanFailed(batch.id, e.message || '识别失败');
    }
  });
});

// ===== 识别结果的人工修正 =====

/**
 * 把某份卷子指给某个学生（AI 认错名字时老师手工纠正）。
 * 传student_id: null 表示取消指派。
 */
router.post('/:id/paper-scan/batches/:batchId/groups/:groupNo/assign', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  try {
    const groupNo = parseInt(req.params.groupNo, 10);
    if (!Number.isFinite(groupNo)) return res.status(400).json({ error: '组号无效' });

    // 校验学生确实在这个作业的班级里，防止把别的班学生指过来。
    // 学生与班级的关联直接存在 users.class_id，没有中间表。
    const sid = req.body?.student_id ? parseInt(req.body.student_id, 10) : null;
    let studentName = String(req.body?.student_name || '').slice(0, 50);
    if (sid !== null) {
      if (!Number.isFinite(sid)) return res.status(400).json({ error: '学生 id 无效' });
      const inClass = db.prepare(
        "SELECT id, real_name, username FROM users WHERE id = ? AND class_id = ? AND role = 'student'"
      ).get(sid, req.assignment.class_id);
      if (!inClass) return res.status(400).json({ error: '该学生不在本班' });
      if (!studentName) studentName = inClass.real_name || inClass.username || '';
    }

    const batch = scanSvc.assignStudent(req.batch.id, groupNo, sid, studentName);
    res.json({ batch: scanSvc.toPublicBatch(batch) });
  } catch (e) {
    console.error('指派学生失败:', e.message);
    res.status(500).json({ error: '指派失败' });
  }
});

/** 保存某份卷子的逐题修正（改对错、改部分分），只覆盖传上来的题 */
router.put('/:id/paper-scan/batches/:batchId/groups/:groupNo/results', authenticateToken, authorizeRole('teacher', 'admin'), requireAssignmentOwner, loadBatch, (req, res) => {
  try {
    const groupNo = parseInt(req.params.groupNo, 10);
    if (!Number.isFinite(groupNo)) return res.status(400).json({ error: '组号无效' });
    const results = req.body?.results;
    if (!Array.isArray(results)) return res.status(400).json({ error: '缺少 results 数组' });
    if (results.length > 200) return res.status(400).json({ error: '单份卷子的题目数异常' });

    const batch = scanSvc.updateGroupResults(req.batch.id, groupNo, results);
    res.json({ batch: scanSvc.toPublicBatch(batch) });
  } catch (e) {
    console.error('保存判分修正失败:', e.message);
    res.status(500).json({ error: '保存失败' });
  }
});

module.exports = router;
