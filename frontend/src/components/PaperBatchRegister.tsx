import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, Button, Upload, Select, Tag, Empty, Spin, message, Space, Alert, InputNumber, Progress, Popconfirm,
} from 'antd';
import { PictureOutlined, RobotOutlined, DeleteOutlined, CheckOutlined, CloseOutlined, SearchOutlined } from '@ant-design/icons';
import { assignmentAPI, classroomQuizAPI } from '../utils/api';
import { compressImage } from '../utils/imageCompress';

interface Q {
  id: number;
  type: string;
  content: string;
  options?: string[] | null;
  answer?: string | null;
}

interface RecognizedResult {
  question_id: number;
  recognized_answer: string;
  is_correct: boolean;
  score: number;
  comment: string;
}

interface PaperItem {
  key: string;
  student_id: number | null;
  student_name: string;
  raw_name: string;
  matched: boolean;
  image_indexes: number[];
  results: RecognizedResult[];
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

const MAX_PHOTOS = 12;

const PaperBatchRegister: React.FC<Props> = ({ assignmentId, title, open, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [registeredIds, setRegisteredIds] = useState<number[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [judging, setJudging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [model, setModel] = useState('');
  const [query, setQuery] = useState('');

  const loadAll = async () => {
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
  };

  useEffect(() => {
    if (open) {
      setPhotos([]);
      setPapers([]);
      setActiveKey(null);
      setModel('');
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assignmentId]);

  const handleAddPhoto = async (file: File) => {
    if (photos.length >= MAX_PHOTOS) {
      message.warning(`一次最多 ${MAX_PHOTOS} 张照片`);
      return;
    }
    try {
      const dataUrl = await compressImage(file);
      setPhotos(prev => [...prev, dataUrl]);
    } catch (e) {
      message.error('图片读取失败');
    }
  };

  const handleAIBatchJudge = async () => {
    if (photos.length === 0) {
      message.warning('请先添加作业照片');
      return;
    }
    setJudging(true);
    try {
      const res = await assignmentAPI.aiPaperJudgeBatch(assignmentId, { images: photos });
      const list: PaperItem[] = (res.data.papers || []).map((p: any, i: number) => ({
        ...p,
        key: `p_${Date.now()}_${i}`,
      }));
      setPapers(list);
      setModel(res.data.model || '');
      setRegisteredIds(res.data.registered_ids || registeredIds);
      setActiveKey(list.length > 0 ? list[0].key : null);
      const unmatched = list.filter(p => !p.student_id).length;
      message.success(
        `识别完成：${list.length} 份试卷${unmatched > 0 ? `，其中 ${unmatched} 份未认出姓名，请手动指派` : ''}`
      );
    } catch (e: any) {
      message.error(e?.response?.data?.error || '批量识别失败');
    } finally {
      setJudging(false);
    }
  };

  const activePaper = papers.find(p => p.key === activeKey) || null;

  const assignedCount = papers.filter(p => p.student_id).length;
  const readyPapers = useMemo(
    () => papers.filter(p => p.student_id && !registeredIds.includes(p.student_id)),
    [papers, registeredIds]
  );

  const updatePaper = (key: string, patch: Partial<PaperItem>) => {
    setPapers(prev => prev.map(p => (p.key === key ? { ...p, ...patch } : p)));
  };

  const setResult = (key: string, questionId: number, patch: Partial<RecognizedResult>) => {
    setPapers(prev => prev.map(p => {
      if (p.key !== key) return p;
      return {
        ...p,
        results: p.results.map(r => (r.question_id === questionId ? { ...r, ...patch } : r)),
      };
    }));
  };

  const removePaper = (key: string) => {
    const next = papers.filter(p => p.key !== key);
    setPapers(next);
    if (activeKey === key) setActiveKey(next.length > 0 ? next[0].key : null);
  };

  const handleSaveAll = async () => {
    if (readyPapers.length === 0) {
      message.warning('没有可登记的学生（需要先指派姓名且该生尚未登记过）');
      return;
    }
    setSaving(true);
    try {
      const submissions = readyPapers.map(p => ({
        student_id: p.student_id as number,
        results: p.results.map(r => {
          const q = questions.find(x => x.id === r.question_id);
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
        setRegisteredIds(prev => [...prev, ...ok.map(x => x.student_id)]);
      }
      if (fail.length > 0) {
        message.warning(`${fail.length} 人未登记：${fail.map(f => f.reason).slice(0, 2).join('；')}`);
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
      .filter(s => !q || (s.real_name || s.username || '').toLowerCase().includes(q))
      .map(s => ({ value: s.id, label: s.real_name || s.username }));
  }, [students, query]);

  return (
    <Modal
      title={`📷 批量扫描纸质作业：${title}`}
      open={open}
      onCancel={onClose}
      zIndex={1100}
      width={1080}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#888', fontSize: 13 }}>
            已识别 {papers.length} 份，已指派 {assignedCount} 份
            {papers.length > 0 && assignedCount < papers.length && (
              <span style={{ color: '#faad14', marginLeft: 8 }}>还有 {papers.length - assignedCount} 份待指派姓名</span>
            )}
          </span>
          <Space>
            <Button onClick={onClose}>关闭</Button>
            <Button
              type="primary"
              loading={saving}
              disabled={readyPapers.length === 0}
              onClick={handleSaveAll}
            >
              一键登记 {readyPapers.length} 人
            </Button>
          </Space>
        </div>
      }
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
    >
      <Spin spinning={loading}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="拍照前请确认"
          description="每份卷子把姓名写在卷首显眼处，一叠卷子逐张拍照上传，AI 会识别姓名自动归到对应学生名下；认不出的会标为「待指派」，手动选一下即可。"
        />

        {/* 照片区 + 批量识别 */}
        <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Upload
              accept="image/*"
              multiple
              showUploadList={false}
              beforeUpload={(file) => { handleAddPhoto(file as File); return false; }}
            >
              <Button icon={<PictureOutlined />}>添加作业照片</Button>
            </Upload>
            <Button
              type="primary"
              icon={<RobotOutlined />}
              loading={judging}
              disabled={photos.length === 0}
              onClick={handleAIBatchJudge}
            >
              {judging ? 'AI识别中…' : `AI批量识别（${photos.length}张）`}
            </Button>
            {photos.length > 0 && (
              <Popconfirm title="清空已上传的照片？" onConfirm={() => { setPhotos([]); setPapers([]); setActiveKey(null); }}>
                <Button size="small" danger icon={<DeleteOutlined />}>清空照片</Button>
              </Popconfirm>
            )}
            {photos.map((p, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={p} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd' }} />
                <span style={{ position: 'absolute', left: 0, bottom: 0, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 10, padding: '0 3px', borderBottomLeftRadius: 4 }}>
                  #{i}
                </span>
                <Button
                  size="small"
                  shape="circle"
                  icon={<DeleteOutlined />}
                  style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, minWidth: 18 }}
                  onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                />
              </div>
            ))}
          </div>
          <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
            最多 {MAX_PHOTOS} 张，自动压缩后上传；识别较慢，请耐心等待（约需 1-2 分钟）。
            {model && <span style={{ marginLeft: 8 }}>使用模型：{model}</span>}
          </div>
        </div>

        {papers.length === 0 ? (
          <Empty description={photos.length === 0 ? '先添加作业照片，再点「AI批量识别」' : '尚未识别，点击上方按钮开始'} />
        ) : (
          <div style={{ display: 'flex', gap: 16 }}>
            {/* 左侧：识别出的试卷列表 */}
            <div style={{ width: 300, flexShrink: 0 }}>
              <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 13 }}>识别结果（按学生分组）</div>
              <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                {papers.map(p => {
                  const active = p.key === activeKey;
                  const already = p.student_id != null && registeredIds.includes(p.student_id);
                  const correctCount = p.results.filter(r => r.is_correct).length;
                  return (
                    <div
                      key={p.key}
                      onClick={() => setActiveKey(p.key)}
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
                        <Button
                          size="small"
                          type="text"
                          icon={<DeleteOutlined />}
                          onClick={(e) => { e.stopPropagation(); removePaper(p.key); }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                        {p.image_indexes.map(idx => (
                          <img key={idx} src={photos[idx]} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 3, border: '1px solid #eee' }} />
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: '#888' }}>
                        AI 读到姓名：{p.raw_name || '(未识别)'}　答对 {correctCount}/{p.results.length}
                        {p.results.length > 0 && (
                          <Progress
                            percent={Math.round((correctCount / p.results.length) * 100)}
                            size="small"
                            style={{ marginTop: 2, marginBottom: 0 }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 右侧：当前试卷的归属与逐题结果 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {!activePaper ? (
                <Empty description="请在左侧选择一份试卷" />
              ) : (
                <>
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    <div style={{ marginBottom: 6, fontSize: 13 }}>
                      归属学生：
                      {activePaper.matched ? (
                        <Tag color="green" style={{ marginLeft: 6 }}>AI 已匹配</Tag>
                      ) : (
                        <Tag color="red" style={{ marginLeft: 6 }}>姓名未识别，请手动选择</Tag>
                      )}
                    </div>
                    <Select
                      style={{ width: '100%' }}
                      placeholder="选择该份作业属于哪位学生"
                      value={activePaper.student_id ?? undefined}
                      onChange={(v) => {
                        const s = students.find(x => x.id === v);
                        updatePaper(activePaper.key, {
                          student_id: v ?? null,
                          student_name: s ? (s.real_name || s.username) : '',
                        });
                      }}
                      showSearch
                      optionFilterProp="label"
                      onSearch={setQuery}
                      filterOption={false}
                      options={studentOptions}
                      suffixIcon={<SearchOutlined />}
                    />
                  </div>

                  {questions.map((q, i) => {
                    const r = activePaper.results.find(x => x.question_id === q.id);
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
                              onClick={() => setResult(activePaper.key, q.id, { is_correct: true })}
                            >
                              对
                            </Button>
                            <Button
                              size="small"
                              type={!correct ? 'primary' : 'default'}
                              danger={!correct}
                              icon={<CloseOutlined />}
                              onClick={() => setResult(activePaper.key, q.id, { is_correct: false, score: isSubjective(q.type) ? 50 : 0 })}
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
                              onChange={(v) => setResult(activePaper.key, q.id, { score: v ?? 0 })}
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
                  <div style={{ color: '#999', fontSize: 12 }}>
                    逐题核对后可点右下角「一键登记」；同一学生已有提交记录的会被跳过。
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
