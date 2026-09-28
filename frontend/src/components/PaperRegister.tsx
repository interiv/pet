import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Input, InputNumber, Button, Tag, Avatar, Empty, Spin, message, Space, Upload } from 'antd';
import { SearchOutlined, CheckOutlined, CloseOutlined, PictureOutlined, RobotOutlined, DeleteOutlined } from '@ant-design/icons';
import { pinyin } from 'pinyin-pro';
import { assignmentAPI, classroomQuizAPI } from '../utils/api';

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

// 压缩图片：长边最大1600px，JPEG 85%，返回 dataURL
const compressImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new window.Image();
    img.onload = () => {
      const maxSide = 1600;
      let width = img.width;
      let height = img.height;
      if (width > height && width > maxSide) { height = Math.round((height * maxSide) / width); width = maxSide; }
      else if (height > maxSide) { width = Math.round((width * maxSide) / height); height = maxSide; }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = String(reader.result);
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const PaperRegister: React.FC<PaperRegisterProps> = ({ assignmentId, title, open, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [registeredIds, setRegisteredIds] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [currentStudent, setCurrentStudent] = useState<any>(null);
  const [marks, setMarks] = useState<Record<number, { correct: boolean; score?: number }>>({});
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [aiJudging, setAiJudging] = useState(false);
  const [recognized, setRecognized] = useState<Record<number, { answer: string; comment: string }>>({});
  const pyCache = useRef<Map<number, string>>(new Map());

  const handleAddPhoto = async (file: File) => {
    if (photos.length >= 6) { message.warning('一次最多6张照片'); return; }
    try {
      const dataUrl = await compressImage(file);
      setPhotos(prev => [...prev, dataUrl]);
    } catch (e) {
      message.error('图片读取失败');
    }
  };

  const handleAIJudge = async () => {
    if (photos.length === 0) { message.warning('请先添加该学生的作业照片'); return; }
    if (!currentStudent) { message.warning('请先在左侧选择这份作业属于哪位学生'); return; }
    setAiJudging(true);
    try {
      const res = await assignmentAPI.aiPaperJudge(assignmentId, { images: photos });
      const results: any[] = res.data.results || [];
      const newMarks: Record<number, { correct: boolean; score?: number }> = {};
      const rec: Record<number, { answer: string; comment: string }> = {};
      for (const r of results) {
        newMarks[r.question_id] = { correct: r.is_correct, score: (!r.is_correct && r.score > 0) ? r.score : undefined };
        rec[r.question_id] = { answer: r.recognized_answer, comment: r.comment };
      }
      setMarks(prev => ({ ...prev, ...newMarks }));
      setRecognized(rec);
      message.success(`AI识别完成（${results.length}题，模型：${res.data.model}），已预填对错，请逐题核对后保存`);
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'AI识别失败');
    } finally {
      setAiJudging(false);
    }
  };

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
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assignmentId]);

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
      setPhotos([]);
      setRecognized({});
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
      width={1000}
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
      styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}
    >
      <Spin spinning={loading}>
        <div style={{ display: 'flex', gap: 16 }}>
          {/* 左侧：学生列表 */}
          <div style={{ width: 240, flexShrink: 0 }}>
            <Input
              placeholder="搜索学生"
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
                    onClick={() => { setCurrentStudent(s); setMarks({}); setPhotos([]); setRecognized({}); }}
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

          {/* 右侧：拍照AI识别 + 逐题登记 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 拍照 AI 识别 */}
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
                  loading={aiJudging}
                  disabled={photos.length === 0 || !currentStudent}
                  onClick={handleAIJudge}
                >
                  {aiJudging ? 'AI识别中...' : 'AI识别判分'}
                </Button>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={p} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd' }} />
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
                {currentStudent
                  ? `为 ${currentStudent.real_name || currentStudent.username} 的纸质作业拍照上传（最多6张，自动压缩），AI识别后预填对错，务必逐题核对再保存。`
                  : '请先在左侧选择学生，再为其作业拍照上传。'}
              </div>
            </div>

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
                          addonAfter="%"
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
