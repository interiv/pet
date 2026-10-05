/**
 * 纸质作业扫描批次服务
 *
 * 解决三个现实问题：
 *   1. 一次几十张照片塞进一个 POST 就是好几 MB 的 base64，必然超时 -> 改为逐张上传、先落盘
 *   2. 识别结果只在内存里，关掉弹窗就没了-> 批次与结果全部落库，重开弹窗/重启服务都还在
 *   3. 识别只有假进度（0% 卡住然后突然跳满）-> 按「组」调用 AI，每组完成更新一次真实进度
 */
const path = require('path');
const fs = require('fs');
const { db } = require('../config/database');

// 与 routes/assignments.js 保持一致：放在已挂载卷的 data/ 下，容器重建不丢文件
const uploadsDir = path.join(__dirname, '../../data/uploads');
let uploadsReady = true;
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch (e) {
  // 建不出来不拖垮服务，但要让上传接口能明确报错，而不是莫名为「0 张照片」
  uploadsReady = false;
  console.warn('[paper-scan] 上传目录创建失败，纸质扫描将不可用:', e.message);
}

/** 扫描照片子目录，同样延迟到真正需要时再建 */
function scanImageDir() {
  const dir = path.join(uploadsDir, 'paper-scan');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new Error('服务器无法创建照片存储目录，请检查 data 目录写入权限：' + e.message);
  }
  return dir;
}

/** 单批次硬上限，防止误传几百张把磁盘塞满 */
const MAX_IMAGES = 300;

const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function safeParse(s) {
  try { return s ? JSON.parse(s) : null; } catch (e) { return null; }
}

function getBatch(id) {
  return db.prepare('SELECT * FROM paper_scan_batches WHERE id = ?').get(id) || null;
}

function createBatch({ assignmentId, userId, title, subject, groupSize, studentId }) {
  const gs = Math.max(1, Math.min(10, parseInt(groupSize, 10) || 1));
  const sid = studentId ? parseInt(studentId, 10) : null;
  // student_id 为空 = 批量扫描（一个批次装着全班，AI 靠姓名自动归属）
  // 有值 = 单人登记（这个批次只服务这一个学生）
  const info = db.prepare("INSERT INTO paper_scan_batches (assignment_id, user_id, title, subject, group_size, upload_status, scan_status, student_id) VALUES (?, ?, ?, ?, ?, 'draft', 'idle', ?)")
    .run(assignmentId, userId, title || '', subject || '', gs, Number.isFinite(sid) ? sid : null);
  return getBatch(info.lastInsertRowid);
}

/**
 * 找某个学生在某份作业下未完成的批次。
 *
 * 单人登记切回一个学生时用它恢复现场。已登记（registered_at 非空）的批次
 * 不复用——那个学生已经登记完了，再开新批次重新扫。
 */
function findStudentBatch(assignmentId, studentId, userId, isAdmin) {
  if (!studentId) return null;
  const row = isAdmin
    ? db.prepare(`
        SELECT * FROM paper_scan_batches
        WHERE assignment_id = ? AND student_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(assignmentId, studentId)
    : db.prepare(`
        SELECT * FROM paper_scan_batches
        WHERE assignment_id = ? AND student_id = ? AND user_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(assignmentId, studentId, userId);
  if (!row) return null;
  // 已登记的批次不再复用
  if (row.registered_at) return null;
  return row;
}

/** 标记批次已登记（成绩已写入 submissions） */
function markRegistered(batchId) {
  db.prepare("UPDATE paper_scan_batches SET registered_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), batchId);
}

const countImages = (batchId) =>
  db.prepare('SELECT COUNT(*) c FROM paper_scan_images WHERE batch_id = ? AND file_path IS NOT NULL').get(batchId).c;

function listImages(batchId) {
  return db.prepare('SELECT * FROM paper_scan_images WHERE batch_id = ? ORDER BY group_no, seq, id').all(batchId);
}

/** 历史批次列表——「下次打开还能看到上次进度」的关键 */
function listBatches(assignmentId, userId, isAdmin) {
  const rows = isAdmin
    ? db.prepare('SELECT * FROM paper_scan_batches WHERE assignment_id = ? ORDER BY id DESC LIMIT 20').all(assignmentId)
    : db.prepare('SELECT * FROM paper_scan_batches WHERE assignment_id = ? AND user_id = ? ORDER BY id DESC LIMIT 20').all(assignmentId, userId);
  return rows.map(toPublicBatch);
}

/**
 * 单人登记模式用：一次拿到每个学生的扫描进度。
 *
 * 左侧学生列表要显示「谁传了几张、谁判完了、谁已登记」，
 * 逐个查批次会变成 N+1 次查询，这里一次聚合出来。
 *
 * @returns {Object<number, {batch_id:number, uploaded:number, total:number, scanned:boolean, registered:boolean}>}
 *          key 是 student_id
 */
function studentProgressMap(assignmentId, userId, isAdmin) {
  const rows = isAdmin
    ? db.prepare(`
        SELECT id, student_id, registered_at, scan_status,
               (SELECT COUNT(*) FROM paper_scan_images WHERE batch_id = paper_scan_batches.id AND file_path IS NOT NULL) AS uploaded,
               (SELECT COUNT(*) FROM paper_scan_images WHERE batch_id = paper_scan_batches.id) AS total
        FROM paper_scan_batches
        WHERE assignment_id = ? AND student_id IS NOT NULL
      `).all(assignmentId)
    : db.prepare(`
        SELECT id, student_id, registered_at, scan_status,
               (SELECT COUNT(*) FROM paper_scan_images WHERE batch_id = paper_scan_batches.id AND file_path IS NOT NULL) AS uploaded,
               (SELECT COUNT(*) FROM paper_scan_images WHERE batch_id = paper_scan_batches.id) AS total
        FROM paper_scan_batches
        WHERE assignment_id = ? AND student_id IS NOT NULL AND user_id = ?
      `).all(assignmentId, userId);

  const map = {};
  for (const r of rows) {
    const sid = r.student_id;
    // 一个学生理论上只有一个未登记批次；若有多条（历史遗留），取信息最全的那条：
    // 已登记 > 已识别 > 照片多
    const prev = map[sid];
    const score = (x) => (x.registered ? 2 : 0) + (x.scanned ? 1 : 0) + (x.uploaded || 0) / 1000;
    if (!prev || score(r) > score(prev)) {
      map[sid] = {
        batch_id: r.id,
        uploaded: r.uploaded || 0,
        total: r.total || 0,
        // scan_status 为 done 才算「已识别」；识别过但有题失败时后端会退回 pending
        scanned: r.scan_status === 'done',
        registered: !!r.registered_at,
      };
    }
  }
  return map;
}

function toPublicBatch(batch) {
  if (!batch) return null;
  const images = listImages(batch.id);
  const total = images.length;
  const uploaded = images.filter((i) => !!i.file_path).length;
  const groups = total > 0 ? Math.ceil(total / batch.group_size) : 0;
  return {
    batch_id: batch.id,
    assignment_id: batch.assignment_id,
    /** 这个批次是为哪个学生扫的；null 表示批量扫描（装着全班） */
    student_id: batch.student_id ?? null,
    /** 是否已登记成绩：区分「已识别」与「已识别且已登记」 */
    registered: !!batch.registered_at,
    registered_at: batch.registered_at || null,
    title: batch.title,
    subject: batch.subject,
    group_size: batch.group_size,
    upload_status: total > 0 && uploaded >= total ? 'uploaded' : batch.upload_status,
    scan_status: batch.scan_status,
    total_images: total,
    uploaded_images: uploaded,
    pending_images: total - uploaded,
    total_groups: groups,
    scanned_groups: batch.scanned_groups || 0,
    result: safeParse(batch.result),
    error: batch.error || null,
    model: batch.model || null,
    created_at: batch.created_at,
    scan_finished_at: batch.scan_finished_at,
    images: images.map((i) => ({
      image_id: i.id, group_no: i.group_no, seq: i.seq,
      uploaded: !!i.file_path, file_name: i.file_name, file_size: i.file_size,
      status: i.status, student_id: i.student_id, raw_name: i.raw_name,
    })),
  };
}
// ===== 照片 =====

/**
 * 追加照片占位记录（还没传文件内容）。
 * 前端先把 N 张全登记成占位，再逐张上传，这样「哪张没传」服务端也知道，刷新不丢。
 */
function addImagePlaceholder(batchId, o) {
  const opt = o || {};
  const info = db.prepare("INSERT INTO paper_scan_images (batch_id, group_no, seq, file_name, file_size, mime_type, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
    .run(batchId, opt.groupNo || 0, opt.seq || 0, opt.fileName || '', opt.fileSize || 0, opt.mimeType || '');
  refreshBatchCounters(batchId);
  return info.lastInsertRowid;
}

function markUploaded(imageId, o) {
  const opt = o || {};
  db.prepare("UPDATE paper_scan_images SET file_path = ?, file_name = COALESCE(NULLIF(?, ''), file_name), file_size = COALESCE(NULLIF(?, 0), file_size), mime_type = COALESCE(NULLIF(?, ''), mime_type), status = 'pending', error = NULL, updated_at = ? WHERE id = ?")
    .run(opt.filePath || '', opt.fileName || '', opt.fileSize || 0, opt.mimeType || '', nowIso(), imageId);
  const img = db.prepare('SELECT batch_id FROM paper_scan_images WHERE id = ?').get(imageId);
  if (img) refreshBatchCounters(img.batch_id);
}

/** 改「每人几张」后重新分组 */
function regroup(batchId, groupSize) {
  const gs = Math.max(1, Math.min(10, parseInt(groupSize, 10) || 1));
  listImages(batchId).forEach((img, idx) => {
    db.prepare('UPDATE paper_scan_images SET group_no = ?, seq = ?, updated_at = ? WHERE id = ?')
      .run(Math.floor(idx / gs), idx % gs, nowIso(), img.id);
  });
  db.prepare('UPDATE paper_scan_batches SET group_size = ?, updated_at = ? WHERE id = ?').run(gs, nowIso(), batchId);
  refreshBatchCounters(batchId);
}

/** 调整顺序：传新的图片 id 顺序（只改序号，不动文件） */
function reorder(batchId, orderedIds) {
  const batch = getBatch(batchId);
  if (!batch) return;
  const gs = batch.group_size;
  const stmt = db.prepare('UPDATE paper_scan_images SET group_no = ?, seq = ?, updated_at = ? WHERE id = ? AND batch_id = ?');
  (orderedIds || []).forEach((imageId, idx) => {
    stmt.run(Math.floor(idx / gs), idx % gs, nowIso(), imageId, batchId);
  });
  refreshBatchCounters(batchId);
}

function deleteImage(imageId) {
  const img = db.prepare('SELECT * FROM paper_scan_images WHERE id = ?').get(imageId);
  if (!img) return;
  if (img.file_path) {
    // 必须用 imageAbsolutePath：照片存在paper-scan/ 子目录下，
    // 直接拼 uploadsDir 会算出一个不存在的路径，unlink 静默失败，
    // 结果是「记录删了、文件还在」，磁盘上不断堆积孤儿照片。
    const abs = imageAbsolutePath(img.file_path);
    try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch (e) { /* 删文件失败不阻塞 */ }
  }
  db.prepare('DELETE FROM paper_scan_images WHERE id = ?').run(imageId);
  refreshBatchCounters(img.batch_id);
}

/**
 * 重算批次计数器，并按 group_size 重新编排 group_no / seq。
 *
 * 关键：分组必须由服务端根据 group_size 统一算，不能指望前端传 group_no。
 * 逐张上传时前端并不知道最终顺序，等传完才定分组；早期版本依赖前端传值，
 * 结果所有照片的 group_no 都是 0，识别时只跑了一组。
 */
function refreshBatchCounters(batchId) {
  const batch = getBatch(batchId);
  if (!batch) return;
  const total = db.prepare('SELECT COUNT(*) c FROM paper_scan_images WHERE batch_id = ?').get(batchId).c;
  const uploaded = countImages(batchId);
  const groups = total > 0 ? Math.ceil(total / batch.group_size) : 0;
  const uploadStatus = total > 0 && uploaded >= total ? 'uploaded' : (uploaded > 0 ? 'uploading' : 'draft');

  // 按当前插入顺序重新编组：同一 group_size 张为一份卷子
  const images = db.prepare('SELECT id FROM paper_scan_images WHERE batch_id = ? ORDER BY seq, id').all(batchId);
  const stmt = db.prepare('UPDATE paper_scan_images SET group_no = ?, seq = ? WHERE id = ?');
  images.forEach((row, idx) => {
    stmt.run(Math.floor(idx / batch.group_size), idx % batch.group_size, row.id);
  });

  db.prepare('UPDATE paper_scan_batches SET total_images = ?, total_groups = ?, upload_status = ?, updated_at = ? WHERE id = ?')
    .run(total, groups, uploadStatus, nowIso(), batchId);
}

// ===== 识别状态 =====

function markScanRunning(batchId, model) {
  db.prepare("UPDATE paper_scan_batches SET scan_status = 'running', scan_started_at = ?, scanned_groups = 0, error = NULL, model = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), model || '', nowIso(), batchId);
}

/**
 * 真实进度：每识别完一组就更新一次。
 * 前端进度条因此稳步前进，而不是卡在 0% 然后突然跳满。
 */
function reportProgress(batchId, scannedGroups, totalGroups) {
  const percent = totalGroups > 0 ? Math.min(99, Math.round((scannedGroups / totalGroups) * 100)) : 30;
  db.prepare("UPDATE paper_scan_batches SET scanned_groups = ?, updated_at = ?, scan_status = CASE WHEN ? >= ? THEN 'done' ELSE 'running' END, scan_finished_at = CASE WHEN ? >= ? THEN ? ELSE scan_finished_at END WHERE id = ?")
    .run(scannedGroups, nowIso(), scannedGroups, totalGroups, scannedGroups, totalGroups, nowIso(), batchId);
  return percent;
}

function markScanDone(batchId, result, model) {
  db.prepare("UPDATE paper_scan_batches SET scan_status = 'done', result = ?, model = ?, error = NULL, scan_finished_at = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(result || {}), model || '', nowIso(), nowIso(), batchId);
}

function markScanFailed(batchId, error) {
  db.prepare("UPDATE paper_scan_batches SET scan_status = 'failed', error = ?, updated_at = ? WHERE id = ?")
    .run(String(error || '').slice(0, 500), nowIso(), batchId);
}

/** 记录某组识别出的学生归属，供下次打开直接展示 */
function attachStudentToGroup(batchId, groupNo, studentId, rawName) {
  db.prepare("UPDATE paper_scan_images SET student_id = ?, raw_name = ?, status = 'done', updated_at = ? WHERE batch_id = ? AND group_no = ?")
    .run(studentId || null, rawName || '', nowIso(), batchId, groupNo);
}

/**
 * 读取某张照片的绝对路径。
 * 扫描照片统一存在 data/uploads/paper-scan/ 子目录下，不能只拼 uploadsDir，
 * 否则会算出不存在的路径、读文件失败，最后表现成「识别 0 组」这种难查的问题。
 */
const imageAbsolutePath = (filePath) =>
  path.join(uploadsDir, 'paper-scan', path.basename(filePath));

// ===== 识别结果的人工修正=====

/**
 * 老师手动把某份卷子指给某个学生，并持久化。
 *
 * 为什么必须有这个接口：AI 认错名字（字迹潦草、名字写错、同名）时，
 * 老师要能手工纠正。以前这个修正只存在浏览器内存里，一刷新就没了，
 * 重新打开又要从头指派一遍——几十份卷子时这是不可接受的。
 *
 * 落两处，缺一不可：
 *   1. paper_scan_images.student_id —— 按组存的归属，下次打开直接带出来
 *   2. batch.result 里的 papers[]—— 识别结果快照，前端渲染与登记都读它
 */
function assignStudent(batchId, groupNo, studentId, studentName) {
  const sid = studentId ? parseInt(studentId, 10) : null;
  db.prepare('UPDATE paper_scan_images SET student_id = ?, updated_at = ? WHERE batch_id = ? AND group_no = ?')
    .run(Number.isFinite(sid) ? sid : null, nowIso(), batchId, groupNo);

  const batch = getBatch(batchId);
  if (!batch) return null;
  const result = safeParse(batch.result) || {};
  const papers = Array.isArray(result.papers) ? result.papers : [];
  const hit = papers.find((p) => p.group_no === groupNo);
  if (hit) {
    hit.student_id = Number.isFinite(sid) ? sid : null;
    hit.student_name = studentName || hit.student_name || '';
    // 人工指派过就算已匹配，matched 只影响前端的「待指派」筛选
    hit.matched = Number.isFinite(sid);
  }
  db.prepare('UPDATE paper_scan_batches SET result = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(result), nowIso(), batchId);
  return getBatch(batchId);
}

/**
 * 保存老师对某份卷子的逐题修正（改对错、改部分分）。
 *
 * 只覆盖传上来的那些题，没传的保持 AI 原本的判断——
 * 前端可能只改了一题就提交，不该把其余题冲掉。
 */
function updateGroupResults(batchId, groupNo, results) {
  const batch = getBatch(batchId);
  if (!batch) return null;
  const result = safeParse(batch.result) || {};
  const papers = Array.isArray(result.papers) ? result.papers : [];
  const hit = papers.find((p) => p.group_no === groupNo);
  if (!hit) return getBatch(batchId);

  const byQid = new Map((Array.isArray(hit.results) ? hit.results : []).map((r) => [r.question_id, r]));
  (Array.isArray(results) ? results : []).forEach((r) => {
    const cur = byQid.get(r.question_id);
    if (!cur) return; // 不属于这卷的题，忽略
    if (r.is_correct !== undefined) cur.is_correct = Boolean(r.is_correct);
    if (r.score !== undefined) cur.score = r.score;
    if (r.comment !== undefined) cur.comment = String(r.comment).slice(0, 500);
    if (r.student_answer !== undefined) cur.student_answer = String(r.student_answer).slice(0, 2000);
  });

  db.prepare('UPDATE paper_scan_batches SET result = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(result), nowIso(), batchId);
  return getBatch(batchId);
}

module.exports = {
  MAX_IMAGES, uploadsDir,
  /** 延迟创建扫描照片子目录：真正上传时才建，避免启动阶段就因权限问题报错 */
  scanImageDir,
  /** 目录是否可用，用于把「无法写入」翻译成用户看得懂的原因 */
  isUploadsReady: () => uploadsReady,
  createBatch, getBatch, listBatches, listImages, toPublicBatch, countImages,
  /** 单人登记：按学生找未完成批次 / 标记已登记 / 各学生进度汇总 */
  findStudentBatch, markRegistered, studentProgressMap,
  addImagePlaceholder, markUploaded, regroup, reorder, deleteImage, refreshBatchCounters,
  markScanRunning, reportProgress, markScanDone, markScanFailed,
  attachStudentToGroup, imageAbsolutePath,
  /** 人工修正：把某组指给某个学生（持久化，刷新不丢） */
  assignStudent,
  /** 人工修正：保存某组的逐题对错与部分分 */
  updateGroupResults,
  markScanCancelled, isScanCancelled, clearScanResult, deleteBatch,
};

// ===== 取消与删除 =====

/**
 * 取消识别（不是回滚）。
 *
 * 取消时还没到「登记」那一步，数据库里没有任何已写入的成绩，
 * 所以只需要停止后续的 AI 调用；已经识别出来的分组结果保留，
 * 老师可以先登记这部分，也可以稍后续跑。
 */
function markScanCancelled(batchId, scannedGroups) {
  db.prepare("UPDATE paper_scan_batches SET scan_status = 'cancelled', scanned_groups = ?, error = NULL, updated_at = ? WHERE id = ?")
    .run(scannedGroups || 0, nowIso(), batchId);
}

/** 识别是否已被取消——识别循环每组开始前都要看一眼 */
function isScanCancelled(batchId) {
  const b = getBatch(batchId);
  return !!b && b.scan_status === 'cancelled';
}

/** 清空识别结果（重新识别时用），保留已上传的照片 */
function clearScanResult(batchId) {
  db.prepare("UPDATE paper_scan_batches SET scan_status = 'idle', result = NULL, error = NULL, scanned_groups = 0, scan_started_at = NULL, scan_finished_at = NULL, updated_at = ? WHERE id = ?")
    .run(nowIso(), batchId);
  db.prepare("UPDATE paper_scan_images SET student_id = NULL, raw_name = '', status = 'pending', updated_at = ? WHERE batch_id = ?")
    .run(nowIso(), batchId);
}

/** 删除整个批次：连带删掉所有已落盘的照片文件 */
function deleteBatch(batchId) {
  const images = listImages(batchId);
  for (const img of images) {
    if (!img.file_path) continue;
    const abs = imageAbsolutePath(img.file_path);
    try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch (e) { /* 删文件失败不阻塞 */ }
  }
  db.prepare('DELETE FROM paper_scan_images WHERE batch_id = ?').run(batchId);
  db.prepare('DELETE FROM paper_scan_batches WHERE id = ?').run(batchId);
}