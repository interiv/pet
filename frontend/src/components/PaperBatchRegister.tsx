import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Modal, Button, Upload, Select, Tag, Empty, Spin, message, Space, Alert, InputNumber, Progress, Popconfirm,
  InputNumber as NumInput, Tooltip, Divider,
} from 'antd';
import {
  PictureOutlined, RobotOutlined, DeleteOutlined, CheckOutlined, CloseOutlined,
  SearchOutlined, ReloadOutlined, StopOutlined, InboxOutlined,
} from '@ant-design/icons';
import { assignmentAPI, classroomQuizAPI } from '../utils/api';
import { usePaperScan } from '../usePaperScan';
import { useScanThumbnails } from '../utils/useScanThumbnails';
import { formatSize } from '../utils/imageCompress';

interface Q {
  id: number;
  type: string;
  content: string;
  options?: string[] | null;
  answer?: string | null;
}

interface PaperResult {
  question_id: number;
  recognized_answer?: string;
  is_correct: boolean;
  score: number;
  comment?: string;
}

interface Paper {
  group_no: number;
  image_ids: number[];
  student_id: number | null;
  student_name?: string;
  raw_name?: string;
  matched: boolean;
  results: PaperResult[];
  error?: string;
}

interface Props {
  assignmentId: number;
  title: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const typeLabel = (t: string) =>
  ({ choice_single: '单选', choice_multi: '多选', judgment: '判断', fill_blank: '填空', essay: '主观' } as Record<string, string>)[t] || t;

const isSubjective = (t: string) => t === 'essay';

const answerText = (q: Q) => {
  if (!q.answer) return '-';
  if (q.type === 'judgment') return q.answer === 'true' ? '正确（√）' : '错误（×）';
  return q.answer;
};

const PaperBatchRegister: React.FC<Props> = ({ assignmentId, title, open, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [registeredIds, setRegisteredIds] = useState<number[]>([]);
  const [activeGroup, setActiveGroup] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** 拖拽中的插入位置（插到第几张之前）。null=未在拖拽 */
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const scan = usePaperScan(assignmentId, open);
  const {
    batch, groupSize, pendingFiles, uploading, scanning, loading: scanLoading,
    compressing, compressProgress,
    pickFiles, uploadAll, startScan, cancelScan, changeGroupSize,
    moveImage, removeImage, discardBatch, setBatch,
  } = scan;

  // 缩略图：把服务端 image_id 映射成可显示的 URL。
  // 只取「已上传」的：占位记录（还没传文件）服务端必然 404，
  // 传上去只会刷一屏红色报错，对老师毫无用处
  const allImageIds = useMemo(
    () => (batch?.images || []).filter((i) => i.uploaded).map((i) => i.image_id),
    [batch?.images]
  );
  const getThumb = useScanThumbnails(assignmentId, batch?.batch_id, allImageIds);

  /** 作业题目 / 学生名单 / 已登记名单——逐题核对与登记都依赖这些 */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const aRes = await assignmentAPI.getAssignment(assignmentId);
      const a = aRes.data.assignment;
      setQuestions(a.questions || []);
      const sRes = await classroomQuizAPI.getClassStudents(a.class_id).catch(() => null);
      setStudents(sRes?.data?.students || []);
      const st = await assignmentAPI.getStatistics(assignmentId).catch(() => null);
      setRegisteredIds((st?.data?.student_results || []).map((r: any) => r.user_id));
    } catch (e) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    if (open) {
      setActiveGroup(null);
      loadAll();
    }
  }, [open, assignmentId, loadAll]);

  // 识别完成后自动选第一份，省一次点击
  useEffect(() => {
    if (activeGroup !== null) return;
    const first = (batch?.result?.papers || [])[0];
    if (first) setActiveGroup(first.group_no);
  }, [batch?.result, activeGroup]);

  const papers: Paper[] = useMemo(() => (batch?.result?.papers || []) as Paper[], [batch?.result]);
  const activePaper = papers.find((p) => p.group_no === activeGroup) || null;

  const totalPhotos = batch?.total_images || 0;
  const uploadedPhotos = batch?.uploaded_images || 0;
  const notUploaded = pendingFiles.filter((p) => !p.uploaded);
  const canStart = totalPhotos > 0 && uploadedPhotos >= totalPhotos && batch?.scan_status !== 'running';
  const scanPercent = batch && batch.total_groups > 0
    ? Math.round((batch.scanned_groups / batch.total_groups) * 100)
    : 0;

  const assignedCount = papers.filter((p) => p.student_id).length;
  const readyPapers = useMemo(
    () => papers.filter((p) => p.student_id && !registeredIds.includes(p.student_id as number)),
    [papers, registeredIds]
  );

  // ===== 人工修正：改判分（本地先动，随后落库）=====
  const setResult = (groupNo: number, questionId: number, patch: Partial<PaperResult>) => {
    if (!batch) return;
    setBatch((prev) => {
      if (!prev?.result?.papers) return prev;
      const nextPapers = (prev.result.papers as Paper[]).map((p) => (p.group_no !== groupNo ? p : {
        ...p,
        results: p.results.map((r) => (r.question_id === questionId ? { ...r, ...patch } : r)),
      }));
      return { ...prev, result: { ...prev.result, papers: nextPapers } };
    });
  };

  /** 把某份卷子的修正保存到服务端（刷新后不丢） */
  const persistResults = async (groupNo: number, results: Array<{ question_id: number; is_correct: boolean; score: number }>) => {
    try {
      const r = await assignmentAPI.saveScanGroupResults(assignmentId, batch!.batch_id, groupNo, results);
      setBatch(r.data.batch);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '修正未保存，刷新后会丢失');
    }
  };

  /** 手动指派学生：落库，刷新后仍在 */
  const handleAssign = async (groupNo: number, studentId: number | null) => {
    const s = students.find((x) => x.id === studentId);
    try {
      const r = await assignmentAPI.assignScanGroup(
        assignmentId, batch!.batch_id, groupNo,
        studentId, s ? (s.real_name || s.username) : ''
      );
      setBatch(r.data.batch);
      message.success(studentId ? `已指派给 ${s ? (s.real_name || s.username) : ''}` : '已取消指派');
    } catch (e: any) {
      message.error(e?.response?.data?.error || '指派失败');
    }
  };

  // ===== 一键登记 =====
  const handleSaveAll = async () => {
    if (readyPapers.length === 0) {
      message.warning('没有可登记的学生（需要先指派姓名且该生尚未登记过）');
      return;
    }
    setSaving(true);
    try {
      const submissions = readyPapers.map((p) => ({
        student_id: p.student_id as number,
        results: p.results.map((r) => {
          const q = questions.find((x) => x.id === r.question_id);
          // 后端对「判错且 score>0」会按百分比折算部分分，只允许主观题走这条路径，
          // 否则客观题会被 AI 误判的分值凭空给分
          const score = !r.is_correct && q && isSubjective(q.type) ? r.score : undefined;
          return {
            question_id: r.question_id,
            is_correct: r.is_correct,
            score,
            student_answer: r.recognized_answer || '纸质作答',
          };
        }),
      }));
      const res = await assignmentAPI.paperSubmitBatch(assignmentId, { submissions });
      const ok: any[] = res.data.succeeded || [];
      const fail: any[] = res.data.failed || [];
      if (ok.length > 0) {
        message.success(`已登记 ${ok.length} 人，平均 ${res.data.total_score_avg} 分`);
        setRegisteredIds((prev) => [...prev, ...ok.map((x) => x.student_id)]);
      }
      if (fail.length > 0) {
        message.warning(`${fail.length} 人未登记：${fail.map((f) => f.reason).slice(0, 2).join('；')}`);
      }
      onSaved();
      if (fail.length === 0) onClose();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '批量登记失败');
    } finally {
      setSaving(false);
    }
  };

  const studentOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students
      .filter((s) => !q || (s.real_name || s.username || '').toLowerCase().includes(q))
      .map((s) => ({ value: s.id, label: s.real_name || s.username }));
  }, [students, query]);

  // ===== 上传阶段 UI =====
  const renderUploadPanel = () => (
    <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <Upload
          accept="image/*"
          multiple
          showUploadList={false}
          beforeUpload={(file) => { pickFiles([file as File]); return false; }}
        >
          <Button icon={<PictureOutlined />} loading={compressing}>选择照片</Button>
        </Upload>
        <Button
          type="primary"
          icon={<InboxOutlined />}
          loading={uploading}
          disabled={pendingFiles.length === 0 || compressing}
          onClick={uploadAll}
        >
          {uploading
            ? `上传中${notUploaded.length ? `（剩 ${notUploaded.length}）` : ''}`
            : `上传全部（${notUploaded.length || pendingFiles.length} 张待传）`}
        </Button>
        <Tooltip title="每位学生的卷子有几张。改这个会重新分组，识别按组进行">
          <span>
            每人张数：
            <NumInput
              min={1}
              max={10}
              size="small"
              value={groupSize}
              style={{ width: 60, marginLeft: 4 }}
              onChange={(v) => {
                const n = Math.max(1, Math.min(10, parseInt(String(v || 1), 10) || 1));
                setBatch((prev) => (prev ? { ...prev, group_size: n } : prev));
                changeGroupSize(n);
              }}
            />
          </span>
        </Tooltip>

        {scanning ? (
          <Button danger icon={<StopOutlined />} onClick={cancelScan}>停止识别</Button>
        ) : (
          <Button
            type="primary"
            ghost
            icon={<RobotOutlined />}
            disabled={!canStart}
            onClick={() => startScan(papers.length > 0 ? 'all' : undefined)}
          >
            {batch?.scan_status === 'cancelled' ? '继续识别' : (papers.length > 0 ? '重新识别' : '开始 AI 识别')}
          </Button>
        )}

        <span style={{ flex: 1 }} />

        {totalPhotos > 0 && (
          <Popconfirm
            title="丢弃这批照片？"
            description="已上传的照片与识别结果都会删掉，无法恢复"
            onConfirm={discardBatch}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>丢弃本批</Button>
          </Popconfirm>
        )}
      </div>

      {/* 压缩进度：压缩在本地跑，主线程会忙一会儿，得让用户知道在做什么 */}
      {compressing && compressProgress && (
        <div style={{ marginTop: 10, padding: '8px 10px', background: '#f6f8fa', borderRadius: 6 }}>
          <Progress
            percent={Math.round((compressProgress.done / Math.max(1, compressProgress.total)) * 100)}
            size="small"
            status="active"
          />
          <div style={{ fontSize: 12, color: '#666' }}>
            正在压缩照片（{compressProgress.done}/{compressProgress.total}）——压完再上传，省流量也更快
          </div>
        </div>
      )}

      {/* 上传进度 */}
      {totalPhotos > 0 && (
        <div style={{ marginBottom: 10 }}>
          <Progress
            percent={totalPhotos > 0 ? Math.round((uploadedPhotos / totalPhotos) * 100) : 0}
            size="small"
            status={uploadedPhotos >= totalPhotos ? 'success' : 'active'}
          />
          <div style={{ fontSize: 12, color: '#666' }}>
            共 {totalPhotos} 张，已上传 {uploadedPhotos} 张
            {uploadedPhotos < totalPhotos ? `（还有 ${totalPhotos - uploadedPhotos} 张没传完，可关掉弹窗稍后继续）` : ''}
            {batch && <>，每 {groupSize} 张一份卷，共 {batch.total_groups} 份</>}
          </div>
        </div>
      )}

      {/* 识别进度 */}
      {scanning && batch && (
        <div style={{ marginBottom: 10, padding: '8px 10px', background: '#f6f8fa', borderRadius: 6 }}>
          <Progress percent={scanPercent} size="small" status="active" />
          <div style={{ fontSize: 12, color: '#666' }}>
            正在识别第 {Math.min(batch.scanned_groups + 1, batch.total_groups)}/{batch.total_groups} 份卷子，可以关掉弹窗，识别会在后台继续
          </div>
        </div>
      )}

      {/* 照片网格：拖拽排序、显示所属组 */}
      {pendingFiles.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
            {pendingFiles.map((p, i) => {
              // 优先用本地小图：选完就能看见，上传后也不必再去服务端拉一遍
              // （那一次拉取以前正是在这里 404 的）。本地没有才回退远端缩略图。
              const url = p.previewUrl || (p.imageId ? getThumb(p.imageId) : undefined);
              const groupNo = batch?.images
                ? batch.images.find((x) => x.image_id === p.imageId)?.group_no
                : undefined;
              // 正在被拖动的那张：半透明，让它像「被拿起来了」
              const isDragging = dragIndex === i;
              // 插入线画在这张的左边。拖到最后一张之后的情况由网格末尾单独画一条
              const showLineBefore = dropIndex === i && dragIndex !== null && dragIndex !== i;
              return (
                <div
                  key={p.key}
                  style={{ position: 'relative', opacity: isDragging ? 0.4 : 1 }}
                >
                {/* 插入位置指示：一条竖向虚线，明确「松手会插到这里」 */}
                {showLineBefore && (
                  <div style={{
                    position: 'absolute', left: -5, top: 0, bottom: 0, width: 0,
                    borderLeft: '2px dashed #1890ff', zIndex: 3, pointerEvents: 'none',
                  }} />
                )}
                <div
                  draggable={!scanning}
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    // 落在左半边插到它前面，右半边插到它后面——
                    // 网格里相邻两张挨得近，只按「谁被悬停」判断会插错方向
                    const rect = e.currentTarget.getBoundingClientRect();
                    const after = e.clientX > rect.left + rect.width / 2;
                    setDropIndex(after ? i + 1 : i);
                  }}
                  onDragLeave={() => { /* 移到子元素上也会触发，用下面的 dragenter 抵消 */ }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const from = dragIndex;
                    const at = dropIndex;
                    setDragIndex(null);
                    setDropIndex(null);
                    if (from === null || at === null) return;
                    let to = at;
                    // 从前往后移时，移除源会让后面的下标前移一位
                    if (from < to) to -= 1;
                    if (from === to) return;
                    await moveImage(from, to);
                  }}
                  style={{
                    position: 'relative', border: '1px solid #e8e8e8',
                    borderRadius: 6, overflow: 'hidden', cursor: scanning ? 'default' : 'grab', background: '#fafafa',
                  }}
                >
                  {url
                    ? <img src={url} alt="" style={{ width: '100%', height: 68, objectFit: 'cover', display: 'block' }} />
                    : (
                      <div style={{ height: 68, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 11, textAlign: 'center', padding: 4 }}>
                        {p.uploaded ? '' : (p.error ? '需重传' : '待上传')}
                      </div>
                    )}
                  <span style={{ position: 'absolute', left: 0, top: 0, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 10, padding: '0 4px', borderBottomRightRadius: 4 }}>
                    #{i + 1}
                  </span>
                  {groupNo !== undefined && (
                    <span style={{ position: 'absolute', right: 0, top: 0, background: groupNo % 2 ? '#1890ff' : '#52c41a', color: '#fff', fontSize: 10, padding: '0 4px', borderBottomLeftRadius: 4 }}>
                      第{groupNo + 1}份
                    </span>
                  )}
                  {p.uploaded && (
                    <span style={{ position: 'absolute', right: 0, bottom: 0, background: 'rgba(82,196,26,.9)', color: '#fff', fontSize: 10, padding: '0 4px', borderTopLeftRadius: 4 }}>
                      已传
                    </span>
                  )}
                  {/* 压缩后体积：让老师直观看到省了多少流量 */}
                  {p.blob.size > 0 && p.blob.size < p.originalSize && (
                    <Tooltip title={`原图 ${formatSize(p.originalSize)} → 压缩后 ${formatSize(p.blob.size)}`}>
                      <span style={{ position: 'absolute', left: 0, bottom: p.uploaded || p.error ? 14 : 0, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 9, padding: '0 3px', borderTopRightRadius: 4 }}>
                        {formatSize(p.blob.size)}
                      </span>
                    </Tooltip>
                  )}
                  {p.error && (
                    <Tooltip title={p.error}>
                      <span style={{ position: 'absolute', left: 0, bottom: 0, background: 'rgba(255,77,79,.95)', color: '#fff', fontSize: 10, padding: '0 4px', borderTopRightRadius: 4 }}>
                        失败
                      </span>
                    </Tooltip>
                  )}
                  {!scanning && (
                    <Button
                      size="small"
                      shape="circle"
                      icon={<DeleteOutlined />}
                      style={{ position: 'absolute', top: 16, right: 2, width: 18, height: 18, minWidth: 18, fontSize: 10 }}
                      onClick={() => removeImage(i)}
                    />
                  )}
                {/* 文件名：手机上文件名往往是一串 IMG_2026...，不看全分不清谁是谁。
                    窄格子里放不下完整名，这里截断显示、悬停出完整名与路径。 */}
                <div
                  title={`${p.file.name}\n完整路径：${(p.file as any).webkitRelativePath || p.file.name}`}
                  style={{
                    fontSize: 9, color: '#888', padding: '2px 3px', lineHeight: 1.3,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    borderTop: '1px solid #eee', background: '#fff',
                  }}
                >
                  {p.file.name}
                </div>
                </div>
                </div>
              );
            })}
            {/* 拖到最后一张之后时的插入线（网格没有「末尾」这一格可挂靠） */}
            {dropIndex === pendingFiles.length && dragIndex !== null && (
              <div style={{
                gridColumn: '1 / -1', height: 0,
                borderTop: '2px dashed #1890ff', marginTop: -4,
              }} />
            )}
          </div>
          <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
            可拖动调整顺序，拖动时会出现竖向虚线指示插入位置；同一份卷子的照片请排在一起。
            照片上传到服务器后关掉弹窗也不会丢。
          </div>
        </>
      )}

      {pendingFiles.length === 0 && totalPhotos === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选择作业照片，再点「上传全部」" style={{ margin: '12px 0' }} />
      )}
    </div>
  );

  return (
    <Modal
      title={`📷 批量扫描纸质作业：${title}`}
      open={open}
      onCancel={onClose}
      width={1120}
      zIndex={1100}
      destroyOnHidden
      styles={{ body: { maxHeight: '74vh', overflowY: 'auto' } }}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, color: '#888', fontSize: 12 }}>
            {papers.length > 0
              ? `识别出 ${papers.length} 份卷子，已指派 ${assignedCount} 份，待登记 ${readyPapers.length} 人`
              : (totalPhotos > 0 ? `共 ${totalPhotos} 张照片，${uploadedPhotos} 张已上传` : '尚未添加照片')}
            {batch?.model ? `　使用模型：${batch.model}` : ''}
          </span>
          <Button onClick={onClose}>关闭</Button>
          {readyPapers.length > 0 && (
            <Button type="primary" loading={saving} onClick={handleSaveAll}>
              一键登记 {readyPapers.length} 人
            </Button>
          )}
        </div>
      }
    >
      <Spin spinning={loading || scanLoading}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="拍照前请确认"
          description="每份卷子把姓名写在卷首显眼处，一叠卷子逐张拍照上传，AI 会识别姓名自动归到对应学生名下；认不出的会标为「待指派」，手动选一下即可。指派与判分修正都会保存，关掉弹窗再打开还在。"
        />

        {renderUploadPanel()}

        {batch?.scan_status === 'failed' && batch.error && (
          <Alert type="error" showIcon style={{ marginBottom: 12 }} message="识别失败" description={batch.error} />
        )}

        {papers.length === 0 ? (
          !scanning && totalPhotos === 0 ? null : (
            <Empty description={scanning ? '识别中，请稍候…' : '尚未识别，点击上方「开始 AI 识别」'} />
          )
        ) : (
          <div style={{ display: 'flex', gap: 16 }}>
            {/* 左：识别出的试卷列表 */}
            <div style={{ width: 290, flexShrink: 0 }}>
              <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 13 }}>识别结果（按学生分组）</div>
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {papers.map((p) => {
                  const active = p.group_no === activeGroup;
                  const already = p.student_id != null && registeredIds.includes(p.student_id);
                  const correctCount = p.results.filter((r) => r.is_correct).length;
                  return (
                    <div
                      key={p.group_no}
                      onClick={() => setActiveGroup(p.group_no)}
                      style={{
                        border: active ? '1px solid #1890ff' : '1px solid #f0f0f0',
                        background: active ? '#e6f7ff' : undefined,
                        borderRadius: 6,
                        padding: '8px 10px',
                        marginBottom: 6,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Tag color={p.matched ? 'blue' : 'red'} style={{ marginRight: 0 }}>
                          {p.matched ? (p.student_name || '未命名') : '待指派'}
                        </Tag>
                        {already && <Tag color="default" style={{ marginRight: 0 }}>已登记</Tag>}
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 11, color: '#bbb' }}>第{p.group_no + 1}份</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                        {(p.image_ids || []).map((id) => {
                          const u = getThumb(id);
                          return u
                            ? <img key={id} src={u} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 3, border: '1px solid #eee' }} />
                            : <div key={id} style={{ width: 34, height: 34, background: '#f0f0f0', borderRadius: 3 }} />;
                        })}
                      </div>
                      {p.error ? (
                        <div style={{ fontSize: 12, color: '#ff4d4f' }}>该份识别失败：{p.error}</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 12, color: '#888' }}>
                            AI 读到姓名：{p.raw_name || '(未识别)'}　答对 {correctCount}/{p.results.length}
                          </div>
                          {p.results.length > 0 && (
                            <Progress
                              percent={Math.round((correctCount / p.results.length) * 100)}
                              size="small"
                              style={{ marginTop: 2, marginBottom: 0 }}
                            />
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 右：当前卷子的归属与逐题结果 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {!activePaper ? (
                <Empty description="请在左侧选择一份试卷" />
              ) : (
                <>
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    <div style={{ marginBottom: 6, fontSize: 13, display: 'flex', alignItems: 'center' }}>
                      归属学生：
                      {activePaper.matched
                        ? <Tag color="green" style={{ marginLeft: 6 }}>已匹配</Tag>
                        : <Tag color="red" style={{ marginLeft: 6 }}>姓名未识别，请手动选择</Tag>}
                      <span style={{ flex: 1 }} />
                      <Button
                        size="small"
                        type="text"
                        icon={<ReloadOutlined />}
                        onClick={() => persistResults(activePaper.group_no, activePaper.results.map((r) => ({ question_id: r.question_id, is_correct: r.is_correct, score: r.score })))}
                      >
                        保存修正
                      </Button>
                    </div>
                    <Select
                      style={{ width: '100%' }}
                      placeholder="选择该份作业属于哪位学生（选完即保存）"
                      value={activePaper.student_id ?? undefined}
                      onChange={(v) => handleAssign(activePaper.group_no, v ?? null)}
                      showSearch
                      optionFilterProp="label"
                      onSearch={setQuery}
                      filterOption={false}
                      options={studentOptions}
                      suffixIcon={<SearchOutlined />}
                      allowClear
                    />
                  </div>

                  {questions.map((q, i) => {
                    const r = activePaper.results.find((x) => x.question_id === q.id);
                    const correct = !!r?.is_correct;
                    return (
                      <div key={q.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <Tag color="blue">第{i + 1}题</Tag>
                          <Tag>{typeLabel(q.type)}</Tag>
                          <span style={{ flex: 1, color: '#555', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {q.content}
                          </span>
                          <Space size={4}>
                            <Button
                              size="small"
                              type={correct ? 'primary' : 'default'}
                              icon={<CheckOutlined />}
                              onClick={() => setResult(activePaper.group_no, q.id, { is_correct: true })}
                            >
                              对
                            </Button>
                            <Button
                              size="small"
                              type={!correct ? 'primary' : 'default'}
                              danger={!correct}
                              icon={<CloseOutlined />}
                              onClick={() => setResult(activePaper.group_no, q.id, { is_correct: false, score: isSubjective(q.type) ? 50 : 0 })}
                            >
                              错
                            </Button>
                          </Space>
                        </div>
                        <div style={{ fontSize: 12, color: '#888' }}>
                          标准答案：<span style={{ color: '#52c41a', fontWeight: 500 }}>{answerText(q)}</span>
                          {r && (
                            <span style={{ marginLeft: 12 }}>
                              <Tag color="purple" style={{ marginRight: 4 }}>AI识别:{r.recognized_answer || '(空)'}</Tag>
                              <span style={{ color: '#999' }}>{r.comment}</span>
                            </span>
                          )}
                        </div>
                        {r && !r.is_correct && isSubjective(q.type) && (
                          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888' }}>
                            部分分：
                            <InputNumber
                              min={0}
                              max={100}
                              value={r.score ?? 0}
                              onChange={(v) => setResult(activePaper.group_no, q.id, { score: v ?? 0 })}
                              size="small"
                              style={{ width: 90 }}
                              suffix="%"
                            />
                            <span>该题得分百分比，例如 60 表示得 60% 的分</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <Divider style={{ margin: '10px 0' }} />
                  <div style={{ color: '#999', fontSize: 12 }}>
                    逐题核对后点右上「保存修正」写入服务器（不会丢）；再点右下「一键登记」写入成绩。同一学生已有提交记录的会被跳过。
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Spin>
    </Modal>
  );
};

export default PaperBatchRegister;
