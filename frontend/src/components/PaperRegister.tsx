import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Modal, Input, InputNumber, Button, Tag, Avatar, Empty, Spin, message, Space, Upload, Progress, Tooltip, Popconfirm, Alert } from 'antd';
import {
  SearchOutlined, CheckOutlined, CloseOutlined, PictureOutlined, RobotOutlined,
  DeleteOutlined, InboxOutlined, StopOutlined, LoadingOutlined,
} from '@ant-design/icons';
import { pinyin } from 'pinyin-pro';
import { assignmentAPI, classroomQuizAPI } from '../utils/api';
import { usePaperScan } from '../usePaperScan';
import { useScanThumbnails } from '../utils/useScanThumbnails';

interface Q {
  id: number;
  type: string;
  content: string;
  options?: string[] | null;
  answer?: string | null;
}

interface PaperRegisterProps {
  assignmentId: number;
  title: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const typeLabel = (t: string) => ({ choice_single: '单选', choice_multi: '多选', judgment: '判断', fill_blank: '填空', essay: '主观' } as Record<string, string>)[t] || t;

const isSubjective = (t: string) => t === 'essay';

const answerText = (q: Q) => {
  if (!q.answer) return '-';
  if (q.type === 'judgment') return q.answer === 'true' ? '正确（√）' : '错误（×）';
  return q.answer;
};

/** 单人登记一次最多 10 张（后端 group_size 上限就是 10，1~10 张都算一份卷子） */
const MAX_SINGLE_PHOTOS = 10;

interface Paper {
  group_no: number;
  image_ids: number[];
  student_id: number | null;
  results: Array<{ question_id: number; recognized_answer?: string; is_correct: boolean; score: number; comment?: string }>;
  error?: string;
}

const PaperRegister: React.FC<PaperRegisterProps> = ({ assignmentId, title, open, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [registeredIds, setRegisteredIds] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [currentStudent, setCurrentStudent] = useState<any>(null);
  const [marks, setMarks] = useState<Record<number, { correct: boolean; score?: number }>>({});
  const [saving, setSaving] = useState(false);
  const [recognized, setRecognized] = useState<Record<number, { answer: string; comment: string }>>({});
  const pyCache = useRef<Map<number, string>>(new Map());
  /**
   * 各学生的扫描进度：student_id -> { uploaded, total, scanned, registered }
   * 左侧列表用它显示「谁传了几张 / 谁已识别 / 谁已登记」。
   * 不逐个学生去查批次，那样会变成 N+1 次请求。
   */
  const [studentProgress, setStudentProgress] = useState<Record<number, {
    uploaded: number; total: number; scanned: boolean; running: boolean; failed: boolean; registered: boolean;
  }>>({});

  // 单人模式：批次绑定到当前学生，切换学生会换成那个学生自己的批次
  const scan = usePaperScan(assignmentId, open, {
    mode: 'single',
    studentId: currentStudent?.id ?? null,
  });
  const {
    batch, pendingFiles, uploading, scanning, loading: scanLoading,
    compressing, compressProgress,
    pickFiles, uploadAll, startScan, cancelScan, removeImage, discardBatch, switchStudent,
    refreshAllProgress,
  } = scan;

  /**
   * 后台识别监视。
   *
   * 识别是在服务端跑的，老师可以在 A 识别期间去弄B、C、D。
   * 但切换学生会停掉「当前批次」的轮询，A 识别完的消息就收不到了。
   * 这里单独开一个轻量轮询（只查汇总接口，不查单个批次），
   * 只要有任何人正在识别就每2 秒刷一次，全部识别完就停。
   * 这样「谁在跑、谁跑完了」始终准确，并且跑完会提示。
   */
  const runningRef = useRef(false);
  useEffect(() => {
    if (!open) { runningRef.current = false; return undefined; }
    const timer = setInterval(async () => {
      const list = await refreshAllProgress();
      const map: Record<number, any> = {};
      (list as any[]).forEach((p) => {
        map[p.student_id] = {
          uploaded: p.uploaded || 0, total: p.total || 0,
          scanned: !!p.scanned, running: !!p.running, failed: !!p.failed, registered: !!p.registered,
        };
      });
      const wasRunning = runningRef.current;
      const nowRunning = (list as any[]).some((p) => p.running);
      setStudentProgress(map);
      runningRef.current = nowRunning;
      // 有人刚才在识别、现在全跑完了 -> 提示一句，否则老师不知道结果已就绪
      if (wasRunning && !nowRunning) {
        const doneCount = (list as any[]).filter((p) => p.scanned || p.registered).length;
        message.success(`AI 识别完成，${doneCount} 位学生的结果已就绪，可点开查看`);
        loadAll();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [open, refreshAllProgress]);

  // 缩略图：鉴权图片要fetch 成 blob 才能显示
  const allImageIds = useMemo(() => (batch?.images || []).map((i) => i.image_id), [batch?.images]);
  const getThumb = useScanThumbnails(assignmentId, batch?.batch_id, allImageIds);

  const papers: Paper[] = useMemo(() => (batch?.result?.papers || []) as Paper[], [batch?.result]);
  const myPaper = papers[0] || null;

  const totalPhotos = batch?.total_images || 0;
  const uploadedPhotos = batch?.uploaded_images || 0;
  const notUploaded = pendingFiles.filter((p) => !p.uploaded);
  const canStart = totalPhotos > 0 && uploadedPhotos >= totalPhotos && batch?.scan_status !== 'running';

  const getPy = (s: any) => {
    if (!pyCache.current.has(s.id)) {
      const name = s.real_name || s.username || '';
      let p = '';
      try { p = pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase(); } catch (e) { /* 忽略 */ }
      pyCache.current.set(s.id, p);
    }
    return pyCache.current.get(s.id)!;
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [aRes, sRes] = await Promise.all([
        assignmentAPI.getAssignment(assignmentId),
        assignmentAPI.getStatistics(assignmentId).catch(() => null),
      ]);
      const assignment = aRes.data.assignment;
      setQuestions(assignment.questions || []);
      setRegisteredIds(new Set((sRes?.data?.student_results || []).map((r: any) => r.user_id)));

      const stRes = await classroomQuizAPI.getClassStudents(assignment.class_id);
      const list: any[] = stRes.data.students || [];
      list.sort((a, b) => {
        const na = a.real_name || a.username || '';
        const nb = b.real_name || b.username || '';
        try { return pinyin(na, { toneType: 'none' }).localeCompare(pinyin(nb, { toneType: 'none' })); }
        catch (e) { return na.localeCompare(nb, 'zh'); }
      });
      setStudents(list);

      // 各学生的扫描进度：左侧列表要显示「谁传了几张、谁判完了」
      const progRes = await assignmentAPI.getScanStudentProgress(assignmentId).catch(() => null);
      const map: typeof studentProgress = {};
      (progRes?.data?.progress || []).forEach((p: any) => {
        map[p.student_id] = {
          uploaded: p.uploaded || 0, total: p.total || 0,
          scanned: !!p.scanned, running: !!p.running, failed: !!p.failed,
          registered: !!p.registered,
        };
      });
      setStudentProgress(map);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setMarks({});
      setCurrentStudent(null);
      setQuery('');
      setRecognized({});
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assignmentId]);

  /**
   * 识别完成后把结果预填到核对区。
   *
   * 之前这段是内联在按钮回调里的，识别是「点一下等结果」，
   * 现在改成后台任务 + 轮询，结果到达的时机与回调无关了，
   * 必须由状态变化来驱动，否则预填会漏掉。
   */
  const appliedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!myPaper || !myPaper.results) return;
    // 同一份识别结果只应用一次，避免老师改过的判分被后续轮询覆盖
    if (appliedRef.current === myPaper.group_no) return;
    appliedRef.current = myPaper.group_no;
    const next: Record<number, { correct: boolean; score?: number }> = {};
    const rec: Record<number, { answer: string; comment: string }> = {};
    for (const r of myPaper.results) {
      next[r.question_id] = { correct: r.is_correct, score: (!r.is_correct && r.score > 0) ? r.score : undefined };
      rec[r.question_id] = { answer: r.recognized_answer || '', comment: r.comment || '' };
    }
    setMarks(next);
    setRecognized(rec);
    message.success(`AI 识别完成（${myPaper.results.length} 题${batch?.model ? `，模型：${batch.model}` : ''}），已预填对错，请逐题核对后保存`);
  }, [myPaper, batch?.model]);

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s => {
      const name = (s.real_name || '').toLowerCase();
      const uname = (s.username || '').toLowerCase();
      return name.includes(q) || uname.includes(q) || getPy(s).includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, query]);

  const setMark = (qid: number, correct: boolean, score?: number) => {
    setMarks(prev => ({ ...prev, [qid]: { correct, score } }));
  };

  const buildResults = () => questions.map(q => {
    const m = marks[q.id] || { correct: true };
    return {
      question_id: q.id,
      is_correct: m.correct,
      // 仅主观题且判错时，允许给出本题的部分分（0-100，按本题占比折算）
      score: (!m.correct && isSubjective(q.type) && typeof m.score === 'number') ? m.score : undefined,
    };
  });

  const unregistered = students.filter(s => !registeredIds.has(s.id));
  // 全班已上传的照片总数，用于在列表底部给个总数
  const uploadedSummary = useMemo(
    () => Object.values(studentProgress).reduce((sum, p) => sum + (p.uploaded || 0), 0),
    [studentProgress]
  );

  /**
   * 切换学生。
   *
   * 三件事一起做，缺一不可：
   *   1. 让 hook 换成这个学生自己的批次——不做的话两个人的照片会混进同一份卷子
   *   2. 暂存当前学生的判分到内存，切回来时还原（未上传的照片无法保留，
   *      但已上传的在服务端；已判分的在 question_answers 表）
   *   3. 清空 marks/recognized，避免把上一个学生的判分存到新学生名下
   */
  const savedMarksRef = useRef<Map<number, { marks: any; recognized: any }>>(new Map());
  const handleSelectStudent = useCallback(async (s: any) => {
    if (currentStudent?.id === s.id) return;
    if (currentStudent) {
      savedMarksRef.current.set(currentStudent.id, { marks, recognized });
    }
    setCurrentStudent(s);
    setMarks({});
    setRecognized({});
    appliedRef.current = null;
    // 换成新学生的批次（顺带清掉本地待传列表）
    const b = await switchStudent(s.id);
    if (!b) return;
    // 该学生之前已经识别过：把服务端的结果读回来，
    // 老师切回来就能接着核对/保存，不用重新识别
    const p = (b.result?.papers || [])[0];
    if (p && Array.isArray(p.results) && p.results.length > 0) {
      const nextMarks: Record<number, { correct: boolean; score?: number }> = {};
      const rec: Record<number, { answer: string; comment: string }> = {};
      p.results.forEach((r: any) => {
        nextMarks[r.question_id] = {
          correct: !!r.is_correct,
          score: (!r.is_correct && r.score > 0) ? r.score : undefined,
        };
        rec[r.question_id] = { answer: r.recognized_answer || '', comment: r.comment || '' };
      });
      setMarks(nextMarks);
      setRecognized(rec);
    }
  }, [currentStudent, marks, recognized, switchStudent]);

  const handleSave = async (andNext: boolean) => {
    if (!currentStudent) { message.warning('请先在左侧选择学生'); return; }
    // 已经登记过的学生再点保存 = 更正成绩（老师追加照片重新识别后用）。
    // 学生端自己提交走的是另一个接口，不经过这里，所以这里放开覆盖是安全的。
    const isOverwrite = registeredIds.has(currentStudent.id);
    if (isOverwrite) {
      const ok = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '更正成绩',
          content: `${currentStudent.real_name || currentStudent.username} 已经登记过（${registeredCount} 人已登记）。`
            + '确定要覆盖之前的成绩吗？覆盖后会重新计算分数与金币，之前的记录将被替换。',
          okText: '确定覆盖',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!ok) { setSaving(false); return; }
    }
    setSaving(true);
    try {
      const res = await assignmentAPI.paperSubmit(assignmentId, {
        student_id: currentStudent.id,
        results: buildResults(),
        overwrite: isOverwrite,
      });
      const name = currentStudent.real_name || currentStudent.username;
      if (res.data.overwritten) {
        message.success(`${name} 成绩已更正为 ${res.data.total_score} 分${res.data.gold_reward > 0 ? `，+${res.data.gold_reward} 金币` : ''}`
          + (res.data.rollback_gold > 0 ? `（已扣回上次发放的 ${res.data.rollback_gold} 金币）` : ''));
      } else {
        message.success(`${name} 登记成功：${res.data.total_score} 分${res.data.gold_reward > 0 ? `，+${res.data.gold_reward} 金币` : ''}`);
      }
      setRegisteredIds(prev => new Set(prev).add(currentStudent.id));

      // 标记批次已登记，但**不删**：
      // 删了的话左侧的「已登记」标记会消失，老师发现某题判错也没法回来改。
      // 想清掉照片和记录，让老师点「丢弃照片」。
      if (batch?.batch_id) {
        try {
          await assignmentAPI.markScanRegistered(assignmentId, batch.batch_id);
        } catch (e) { /* 标记失败只影响列表标记，不影响登记结果 */ }
      }
      setStudentProgress((prev) => ({
        ...prev,
        [currentStudent.id]: {
          ...(prev[currentStudent.id] || { uploaded: 0, total: 0, scanned: false }),
          registered: true,
        },
      }));
      setMarks({});
      setRecognized({});
      appliedRef.current = null;

      if (andNext) {
        const next = students.find(s => s.id !== currentStudent.id && !registeredIds.has(s.id));
        if (next) {
          await handleSelectStudent(next);
        } else {
          setCurrentStudent(null);
          setMarks({});
          message.info('全班已登记完成');
        }
      } else {
        onSaved();
        onClose();
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '登记失败');
    } finally {
      setSaving(false);
    }
  };

  const registeredCount = registeredIds.size;

  return (
    <Modal
      title={`纸质作业登记：${title}`}
      open={open}
      onCancel={onClose}
      zIndex={1100}
      width={1040}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#888', fontSize: 13 }}>
            已登记 {registeredCount}/{students.length} 人
            {currentStudent && <span style={{ color: '#52c41a', marginLeft: 12 }}>当前：{currentStudent.real_name || currentStudent.username}</span>}
          </span>
          {/* 底部只留「关闭」。
              「保存 / 保存并登记下一个」放在识别按钮那一组里——
              那一组是「处理一个人」的完整动作，放在一起才看得出是逐个处理的，
              和「批量扫描」（一次处理全班）在界面上明确区分开。 */}
          <Button onClick={onClose}>关闭</Button>
        </div>
      }
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      <Spin spinning={loading || scanLoading}>
        <div style={{ display: 'flex', gap: 16 }}>
          {/* 左侧：学生列表 */}
          <div style={{ width: 240, flexShrink: 0 }}>
            <Input
              placeholder="搜索学生（支持拼音）"
              prefix={<SearchOutlined style={{ color: '#999' }} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              allowClear
              style={{ marginBottom: 8 }}
            />
            <div style={{ maxHeight: 480, overflow: 'auto' }}>
              {filteredStudents.map(s => {
                const registered = registeredIds.has(s.id);
                const active = currentStudent?.id === s.id;
                const prog = studentProgress[s.id];
                // 未上传的本地张数：只有正在处理这个学生时才有意义
                // 「选N」= 本机已选但还没上传的张数。与「传N」分开统计，
                // 老师才能一眼看出「还剩几张没传」，而不是把已传的也算进去。
                // 非当前学生时看不到他的本地暂存（那在本机内存里，切过去才知道），
                // 所以只有正在处理的人才显示「选N」。
                const notUploadedCount = active ? pendingFiles.filter((p) => !p.uploaded).length : 0;
                const uploadedCount = prog?.uploaded || 0;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelectStudent(s)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
                      borderRadius: 6, cursor: 'pointer', marginBottom: 4,
                      background: active ? '#e6f7ff' : undefined,
                      border: active ? '1px solid #1890ff' : '1px solid #f0f0f0',
                      opacity: registered ? 0.6 : 1,
                    }}
                  >
                    <Avatar size={26} style={{ background: registered ? '#bfbfbf' : '#1890ff' }}>
                      {(s.real_name || s.username || '?').slice(0, 1)}
                    </Avatar>
                    <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.real_name || s.username}
                    </span>
                    {/* 三个数字各代表一件事，可叠加出现：
                        选N=本机已选还没传　传N=已到服务器　识N/已判=AI 判完
                        例：选1传1= 又加了一张还没传、之前传过一张 */}
                    {notUploadedCount > 0 && (
                      <Tooltip title={`本机已选 ${notUploadedCount} 张，还没点「上传全部」`}>
                        <Tag color="orange" style={{ marginRight: 2, fontSize: 11, padding: '0 4px' }}>选{notUploadedCount}</Tag>
                      </Tooltip>
                    )}
                    {uploadedCount > 0 && (
                      <Tooltip title={`已上传到服务器 ${uploadedCount} 张`}>
                        <Tag color="blue" style={{ marginRight: 2, fontSize: 11, padding: '0 4px' }}>传{uploadedCount}</Tag>
                      </Tooltip>
                    )}
                    {/* 识别中：老师可以放心去弄别的学生，这个标签让他知道
                        这个人还在跑、不会白等，也不会以为卡死了 */}
                    {prog?.running && (
                      <Tooltip title="AI 正在识别这个学生的卷子，可以先去处理其他学生">
                        <Tag color="processing" style={{ marginRight: 2, fontSize: 11, padding: '0 4px' }}>
                          <LoadingOutlined spin style={{ fontSize: 10, marginRight: 2 }} />识别中
                        </Tag>
                      </Tooltip>
                    )}
                    {prog?.scanned && !registered && !prog?.running && (
                      <Tooltip title="AI 已识别判分完成，还没登记成绩。点这个学生可以核对后保存">
                        <Tag color="gold" style={{ marginRight: 2, fontSize: 11, padding: '0 4px' }}>识1</Tag>
                      </Tooltip>
                    )}
                    {registered && <Tag color="default" style={{ marginRight: 0, fontSize: 11, padding: '0 4px' }}>已登记</Tag>}
                  </div>
                );
              })}
              {filteredStudents.length === 0 && <Empty description="没有匹配的学生" />}
            </div>
            <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
              未登记 {unregistered.length} 人
              {uploadedSummary > 0 && <span style={{ marginLeft: 8 }}>已拍照 {uploadedSummary} 张</span>}
            </div>
          </div>

          {/* 右侧：拍照上传 + 逐题核对 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 当前照片归属提示：照片不再随切换学生丢弃，必须明确标出属于谁 */}
            {totalPhotos > 0 && (
              <Alert
                type={currentStudent ? 'info' : 'warning'}
                showIcon
                style={{ marginBottom: 10 }}
                message={currentStudent
                  ? `这 ${totalPhotos} 张照片将登记给：${currentStudent.real_name || currentStudent.username}`
                  : `已上传 ${totalPhotos} 张照片，但还没选学生。请先在左侧选择这份作业属于谁`}
              />
            )}

            <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 10, marginBottom: 12 }}>
              {/* 顶部先说清「现在在给谁拍照」——照片归属错了后面全错 */}
              <div style={{ fontSize: 13, marginBottom: 8, color: '#555' }}>
                {currentStudent ? (
                  <>当前处理：<strong style={{ color: '#1890ff' }}>{currentStudent.real_name || currentStudent.username}</strong>
                    <span style={{ color: '#999', fontSize: 12 }}>（照片与判分都只属于这个学生）</span>
                  </>
                ) : (
                  <span style={{ color: '#fa8c16' }}>请先在左侧点一个学生，再为 TA 拍照 —— 照片要记在谁名下</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Upload
                  accept="image/*"
                  multiple
                  showUploadList={false}
                  // 没选学生时禁止添加：否则照片不知道该记在谁名下
                  disabled={!currentStudent || scanning}
                  beforeUpload={(file) => {
                    if (!currentStudent) {
                      message.warning('请先在左侧选择学生');
                      return false;
                    }
                    if (pendingFiles.length >= MAX_SINGLE_PHOTOS) {
                      message.warning(`一次最多 ${MAX_SINGLE_PHOTOS} 张照片`);
                      return false;
                    }
                    pickFiles([file as File]);
                    return false;
                  }}
                >
                  <Button icon={<PictureOutlined />} loading={compressing} disabled={!currentStudent}>添加照片</Button>
                </Upload>
                <Button
                  icon={<InboxOutlined />}
                  loading={uploading}
                  disabled={pendingFiles.length === 0 || compressing || !currentStudent}
                  onClick={uploadAll}
                >
                  {uploading ? `上传中（剩 ${notUploaded.length}）` : `上传全部${notUploaded.length ? `（${notUploaded.length}）` : ''}`}
                </Button>

                {scanning ? (
                  <Button danger icon={<StopOutlined />} onClick={cancelScan}>停止识别</Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<RobotOutlined />}
                    disabled={!canStart || !currentStudent}
                    onClick={() => startScan(papers.length > 0 ? 'all' : undefined)}
                  >
                    {myPaper ? '重新识别' : 'AI 识别判分'}
                  </Button>
                )}

                {/* 保存与识别放在同一组：这一组就是「处理一个人」全过程，
                    老师一眼能看出这里是逐个处理，与批量扫描不同。
                    文案区分「登记」与「更正」——已登记的学生再点保存是改成绩，
                    得让老师知道自己在做什么。 */}
                <Button
                  disabled={!currentStudent || saving || !myPaper}
                  loading={saving}
                  onClick={() => handleSave(false)}
                >
                  {registeredIds.has(currentStudent?.id || 0) ? '更正成绩' : '保存'}
                </Button>
                <Button
                  type="primary"
                  disabled={!currentStudent || saving || !myPaper}
                  loading={saving}
                  onClick={() => handleSave(true)}
                >
                  {registeredIds.has(currentStudent?.id || 0) ? '更正并登记下一个' : '保存并登记下一个'}
                </Button>

                <span style={{ flex: 1 }} />

                {totalPhotos > 0 && (
                  <Popconfirm
                    title="丢弃这批照片？"
                    description="已上传的照片会从服务器删除，无法恢复"
                    onConfirm={async () => {
                      await discardBatch();
                      setMarks({});
                      setRecognized({});
                      appliedRef.current = null;
                    }}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>丢弃照片</Button>
                  </Popconfirm>
                )}
              </div>

              {/* 压缩进度：压缩在本地跑，界面会忙一会儿 */}
              {compressing && compressProgress && (
                <div style={{ marginTop: 10, padding: '8px 10px', background: '#f6f8fa', borderRadius: 6, marginBottom: 10 }}>
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
                <div style={{ marginTop: 10 }}>
                  <Progress
                    percent={Math.round((uploadedPhotos / totalPhotos) * 100)}
                    size="small"
                    status={uploadedPhotos >= totalPhotos ? 'success' : 'active'}
                  />
                  <div style={{ fontSize: 12, color: '#666' }}>
                    共 {totalPhotos} 张，已上传 {uploadedPhotos} 张
                    {uploadedPhotos < totalPhotos ? '（没传完可关掉弹窗，稍后继续）' : ''}
                  </div>
                </div>
              )}

              {/* 识别进度 */}
              {scanning && batch && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: '#f6f8fa', borderRadius: 6 }}>
                  <Progress
                    percent={batch.total_groups > 0 ? Math.round((batch.scanned_groups / batch.total_groups) * 100) : 0}
                    size="small"
                    status="active"
                  />
                  <div style={{ fontSize: 12, color: '#666' }}>AI 正在判分，可以关掉弹窗，识别会在后台继续</div>
                </div>
              )}

              {/* 照片网格 */}
              {pendingFiles.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8, marginTop: 10 }}>
                  {pendingFiles.map((p, i) => {
                    const url = p.imageId ? getThumb(p.imageId) : undefined;
                    return (
                      <div
                        key={p.key}
                        style={{ position: 'relative', border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden', background: '#fafafa' }}
                      >
                        {url
                          ? <img src={url} alt="" style={{ width: '100%', height: 66, objectFit: 'cover', display: 'block' }} />
                          : (
                            <div style={{ height: 66, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 11 }}>
                              {p.uploaded ? '' : (p.error ? '需重传' : '待上传')}
                            </div>
                          )}
                        <span style={{ position: 'absolute', left: 0, top: 0, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 10, padding: '0 4px', borderBottomRightRadius: 4 }}>
                          #{i + 1}
                        </span>
                        {p.uploaded && (
                          <span style={{ position: 'absolute', right: 0, bottom: 0, background: 'rgba(82,196,26,.9)', color: '#fff', fontSize: 10, padding: '0 4px', borderTopLeftRadius: 4 }}>
                            已传
                          </span>
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
                        {/* 文件名：手机拍照都是 IMG_2026xxxx，看序号根本分不清谁是谁 */}
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
                    );
                  })}
                </div>
              )}

              {/* 分步骤说明。原先一句「直接上传到服务器（关掉弹窗不丢）」
                  有歧义：读者分不清「添加照片」到底写没写库。这里按三步说清楚：
                  添加只在本机；点上传才落库；点保存才登记成绩。 */}
              <div style={{ color: '#888', fontSize: 12, marginTop: 8, lineHeight: 1.8 }}>
                <div>① <strong>添加照片</strong>：只存在本机，关掉弹窗会丢失，请确认选好了再传。</div>
                <div>② <strong>上传全部</strong>：照片存到服务器，之后关掉弹窗、重启服务都还在。</div>
                <div>③ <strong>AI 识别判分 → 保存</strong>：识别结果会先存下来，确认无误再点「保存」把成绩登记进去。</div>
                <div style={{ color: '#bbb', marginTop: 2 }}>单个学生最多 {MAX_SINGLE_PHOTOS} 张（这几张会当作一份卷子一起识别）。</div>
              </div>
            </div>

            {batch?.scan_status === 'failed' && batch.error && (
              <Alert type="error" showIcon style={{ marginBottom: 12 }} message="识别失败" description={batch.error} />
            )}
            {myPaper?.error && (
              <Alert type="error" showIcon style={{ marginBottom: 12 }} message="这份卷子识别失败" description={myPaper.error} />
            )}

            {questions.length === 0 ? (
              <Empty description="该作业没有题目" />
            ) : (
              questions.map((q, i) => {
                const m = marks[q.id] || { correct: true };
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
                          type={m.correct ? 'primary' : 'default'}
                          icon={<CheckOutlined />}
                          onClick={() => setMark(q.id, true)}
                        >
                          对
                        </Button>
                        <Button
                          size="small"
                          danger={m.correct ? false : true}
                          type={!m.correct ? 'primary' : 'default'}
                          icon={<CloseOutlined />}
                          onClick={() => setMark(q.id, false, isSubjective(q.type) ? 50 : undefined)}
                        >
                          错
                        </Button>
                      </Space>
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      标准答案：<span style={{ color: '#52c41a', fontWeight: 500 }}>{answerText(q)}</span>
                      {recognized[q.id] && (
                        <span style={{ marginLeft: 12 }}>
                          <Tag color="purple" style={{ marginRight: 4 }}>AI识别:{recognized[q.id].answer}</Tag>
                          <span style={{ color: '#999' }}>{recognized[q.id].comment}</span>
                        </span>
                      )}
                    </div>
                    {!m.correct && isSubjective(q.type) && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888' }}>
                        部分分（本题按百分比计）：
                        <InputNumber
                          min={0}
                          max={100}
                          value={m.score ?? 0}
                          onChange={(v) => setMark(q.id, false, v ?? 0)}
                          size="small"
                          style={{ width: 90 }}
                          suffix="%"
                        />
                        <span>例如给 60 表示该题得 60% 的分</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {questions.length > 0 && (
              <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                默认全部判"对"，只需点出答错的题；主观题判错后可给部分分。总分为各题占比之和。
              </div>
            )}
          </div>
        </div>
      </Spin>
    </Modal>
  );
};

export default PaperRegister;
