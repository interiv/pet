import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Modal, Input, InputNumber, Button, Tag, Avatar, Empty, Spin, message, Space, Upload, Progress, Tooltip, Popconfirm, Alert } from 'antd';
import {
  SearchOutlined, CheckOutlined, CloseOutlined, PictureOutlined, RobotOutlined,
  DeleteOutlined, InboxOutlined, StopOutlined,
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

  // 单人模式：每次开新批次、照片按一份卷子处理
  const scan = usePaperScan(assignmentId, open, { mode: 'single' });
  const {
    batch, pendingFiles, uploading, scanning, loading: scanLoading,
    compressing, compressProgress,
    pickFiles, uploadAll, startScan, cancelScan, removeImage, discardBatch,
  } = scan;

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

  /**
   * 切换学生时不再直接丢弃照片。
   *
   * 以前是 setPhotos([])：老师给 A 拍完、切到 B 看一眼、切回来发现要重拍，
   * 而拍照这件事本身成本很高。现在照片和识别结果保留，
   * 由顶部「当前照片归属」明确标出属于谁，避免误用到别的学生名下。
   *
   * 但判分结果必须清：它对应的是上一位学生的卷面，
   * 留着会被老师当成新学生的判分一起保存出去。
   */
  const handleSelectStudent = useCallback((s: any) => {
    if (currentStudent && currentStudent.id !== s.id && myPaper && myPaper.results.length > 0) {
      message.warning('已切换学生，判分结果已清空（照片会保留，需要重新识别）');
      setMarks({});
      setRecognized({});
      appliedRef.current = null;
    }
    setCurrentStudent(s);
  }, [currentStudent, myPaper]);

  const handleSave = async (andNext: boolean) => {
    if (!currentStudent) { message.warning('请先在左侧选择学生'); return; }
    setSaving(true);
    try {
      const res = await assignmentAPI.paperSubmit(assignmentId, {
        student_id: currentStudent.id,
        results: buildResults(),
      });
      message.success(`${currentStudent.real_name || currentStudent.username} 登记成功：${res.data.total_score} 分${res.data.gold_reward > 0 ? `，+${res.data.gold_reward} 金币` : ''}`);
      setRegisteredIds(prev => new Set(prev).add(currentStudent.id));

      // 登记完这批照片就没用了，连带磁盘文件一起清掉，避免堆积
      if (batch?.batch_id) {
        try { await discardBatch(); } catch (e) { /* 清理失败不阻塞登记结果 */ }
      }
      setMarks({});
      setRecognized({});
      appliedRef.current = null;

      if (andNext) {
        const next = students.find(s => s.id !== currentStudent.id && !registeredIds.has(s.id));
        setCurrentStudent(next || null);
        setMarks({});
        if (!next) message.info('全班已登记完成');
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
          <Space>
            <Button onClick={onClose}>关闭</Button>
            <Button disabled={!currentStudent} loading={saving} onClick={() => handleSave(true)}>保存并登记下一个</Button>
            <Button type="primary" disabled={!currentStudent} loading={saving} onClick={() => handleSave(false)}>保存</Button>
          </Space>
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
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelectStudent(s)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                      borderRadius: 6, cursor: 'pointer', marginBottom: 4,
                      background: active ? '#e6f7ff' : undefined,
                      border: active ? '1px solid #1890ff' : '1px solid #f0f0f0',
                      opacity: registered ? 0.55 : 1,
                    }}
                  >
                    <Avatar size={26} style={{ background: registered ? '#bfbfbf' : '#1890ff' }}>
                      {(s.real_name || s.username || '?').slice(0, 1)}
                    </Avatar>
                    <span style={{ flex: 1, fontSize: 13 }}>{s.real_name || s.username}</span>
                    {registered && <Tag color="default" style={{ marginRight: 0 }}>已登记</Tag>}
                  </div>
                );
              })}
              {filteredStudents.length === 0 && <Empty description="没有匹配的学生" />}
            </div>
            <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
              未登记 {unregistered.length} 人
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Upload
                  accept="image/*"
                  multiple
                  showUploadList={false}
                  beforeUpload={(file) => {
                    if (pendingFiles.length >= MAX_SINGLE_PHOTOS) {
                      message.warning(`一次最多 ${MAX_SINGLE_PHOTOS} 张照片`);
                      return false;
                    }
                    pickFiles([file as File]);
                    return false;
                  }}
                >
                  <Button icon={<PictureOutlined />} loading={compressing}>添加作业照片</Button>
                </Upload>
                <Button
                  icon={<InboxOutlined />}
                  loading={uploading}
                  disabled={pendingFiles.length === 0 || compressing}
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
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
                最多 {MAX_SINGLE_PHOTOS} 张，直接上传到服务器（关掉弹窗不丢）。识别后请务必逐题核对再保存。
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
