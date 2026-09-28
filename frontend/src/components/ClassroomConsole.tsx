import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Select, InputNumber, Input, Tag, Avatar, Empty, Spin, message, Checkbox, Space, Modal, Table, Slider
} from 'antd';
import {
  LeftOutlined, RightOutlined, CloseOutlined, ThunderboltOutlined,
  GiftOutlined, UserSwitchOutlined, DeleteOutlined, StopOutlined, ReloadOutlined, SearchOutlined,
  SoundOutlined, PauseCircleOutlined, PlayCircleOutlined, AudioOutlined, BarChartOutlined,
  CheckCircleOutlined, CloseCircleOutlined
} from '@ant-design/icons';
import { pinyin } from 'pinyin-pro';
import { classroomQuizAPI, itemAPI, equipmentAPI } from '../utils/api';
import { getPetThumbUrl } from '../utils/petImage';

const REWARD_TYPES: Record<string, string> = {
  gold: '金币',
  item: '物品',
  equipment: '装备',
  exp: '经验',
};

const QUICK_AMOUNTS = [1, 5, 10, 20, 50];
// QWERTY 键盘布局，符合输入习惯
const KEYPAD_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const rarityLabel = (r: string) =>
  ({ common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' } as Record<string, string>)[r] || r;

interface ConsoleProps {
  quiz: any;
  questions: any[];
  onClose: () => void;
  onRewarded: () => void;
}

const ClassroomConsole: React.FC<ConsoleProps> = ({ quiz, questions, onClose, onRewarded }) => {
  // 题目展示
  const [index, setIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoSeconds, setAutoSeconds] = useState(30);

  // 抢答倒计时
  const [buzzTotal, setBuzzTotal] = useState(30);
  const [buzzLeft, setBuzzLeft] = useState<number | null>(null);

  // 学生面板
  const [students, setStudents] = useState<any[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // 随机点名
  const [randomState, setRandomState] = useState<{ rolling: boolean; name: string; student: any } | null>(null);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 奖励表单
  const [rewardType, setRewardType] = useState('gold');
  const [rewardValue, setRewardValue] = useState<number | null>(10);
  const [rewardName, setRewardName] = useState('课堂奖励');
  const [rewardReason, setRewardReason] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [reasonTouched, setReasonTouched] = useState(false);
  const [rewarding, setRewarding] = useState(false);

  // 物品 / 装备列表
  const [items, setItems] = useState<any[]>([]);
  const [equipments, setEquipments] = useState<any[]>([]);

  // 语音朗读（TTS）
  const [voices, setVoices] = useState<any[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>(() => localStorage.getItem('cls_tts_voice') || '');
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  // 语音答题 + AI 评判
  const [answerer, setAnswerer] = useState<any>(null);
  const [answerText, setAnswerText] = useState('');
  const [listening, setListening] = useState(false);
  const [judging, setJudging] = useState(false);
  const [judgeSeconds, setJudgeSeconds] = useState(0);
  const [judgeResult, setJudgeResult] = useState<any>(null);
  const [perQValue, setPerQValue] = useState(10);
  // 本课堂的全部答题记录（服务端持久化，打开控制台即加载）
  const [records, setRecords] = useState<any[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // 投屏字号缩放
  const [fontScale, setFontScale] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('cls_font_scale') || '1');
    return isNaN(v) ? 1 : Math.min(1.8, Math.max(0.7, v));
  });
  const recRef = useRef<any>(null);

  const currentQuestion = questions[index];

  // ===== 语音朗读 =====
  const loadVoices = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const vs: any[] = synth.getVoices() || [];
    if (vs.length === 0) return;
    // 按名称+语言去重
    const seen = new Set<string>();
    const uniq = vs.filter(v => {
      const k = `${v.name}|${v.lang}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // 全部列出，中文语音排最前
    const isZh = (v: any) => /^zh|cmn/i.test(v.lang) || /中文|汉语|普通话|Chinese/i.test(v.name);
    setVoices(uniq.sort((a, b) => (isZh(a) ? 0 : 1) - (isZh(b) ? 0 : 1)));
  };

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
    // 部分浏览器语音列表延迟加载，多补几次
    const timers = [500, 1500, 3000].map(ms => setTimeout(loadVoices, ms));
    // 若只检测到一个声音，先"唤醒"一次语音引擎再重载（部分浏览器首次合成前不返回完整列表）
    const wake = setTimeout(() => {
      if ((synth.getVoices()?.length || 0) <= 1) {
        try {
          const u = new SpeechSynthesisUtterance(' ');
          u.volume = 0;
          synth.speak(u);
        } catch (e) { /* 忽略 */ }
        setTimeout(loadVoices, 600);
      }
    }, 2000);
    return () => {
      synth.removeEventListener?.('voiceschanged', loadVoices);
      timers.forEach(clearTimeout);
      clearTimeout(wake);
      synth.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speakText = (text?: string) => {
    const synth = window.speechSynthesis;
    if (!synth) { message.warning('当前浏览器不支持语音朗读'); return; }
    const t = text || currentQuestion?.question_text || '';
    if (!t) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(t);
    const v = voices.find(x => x.voiceURI === voiceURI)
      || voices.find(x => /yunxi|云希/i.test(x.name))
      || voices.find(x => /zh/i.test(x.lang))
      || voices[0];
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'zh-CN'; }
    u.onend = () => { setSpeaking(false); setPaused(false); };
    u.onerror = () => { setSpeaking(false); setPaused(false); };
    setSpeaking(true); setPaused(false);
    synth.speak(u);
  };

  const pauseSpeech = () => { window.speechSynthesis?.pause(); setPaused(true); };
  const resumeSpeech = () => { window.speechSynthesis?.resume(); setPaused(false); };
  const stopSpeech = () => { window.speechSynthesis?.cancel(); setSpeaking(false); setPaused(false); };

  // ===== 学生与拼音检索 =====
  const pyCache = useRef<Map<number, { full: string; initials: string }>>(new Map());
  const getPy = (s: any) => {
    const key = s.id;
    if (!pyCache.current.has(key)) {
      const name = s.real_name || s.username || '';
      let py = { full: '', initials: '' };
      try {
        py = {
          full: pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase(),
          initials: pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase(),
        };
      } catch (e) { /* 忽略 */ }
      pyCache.current.set(key, py);
    }
    return pyCache.current.get(key)!;
  };

  const loadStudents = async () => {
    setStudentsLoading(true);
    try {
      const res = await classroomQuizAPI.getClassStudents(quiz.class_id);
      const list: any[] = res.data.students || [];
      // 按姓名拼音排序，便于查找
      list.sort((a, b) => {
        const na = a.real_name || a.username || '';
        const nb = b.real_name || b.username || '';
        try {
          return pinyin(na, { toneType: 'none' }).localeCompare(pinyin(nb, { toneType: 'none' }));
        } catch (e) {
          return na.localeCompare(nb, 'zh');
        }
      });
      setStudents(list);
    } catch (e) {
      message.error('加载学生列表失败');
    } finally {
      setStudentsLoading(false);
    }
  };

  // 加载本课堂的全部答题记录
  const loadAnswers = async () => {
    try {
      const res = await classroomQuizAPI.getQuizDetail(quiz.id);
      const list: any[] = res.data.answers || [];
      // 顺序：按时间正序展示
      const normalized = list.slice().reverse().map(a => ({
        ...a,
        questionIndex: Math.max(0, questions.findIndex(q => q.id === a.question_id)),
      }));
      setRecords(normalized);
    } catch (e) {
      // 加载失败不影响课堂进行
    }
  };

  useEffect(() => {
    loadStudents();
    loadAnswers();
    return () => {
      if (rollTimer.current) clearInterval(rollTimer.current);
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 默认奖励名称（类型变化且未被手动修改时）
  useEffect(() => {
    if (!nameTouched) {
      setRewardName(rewardType === 'gold' ? '课堂奖励' : rewardType === 'exp' ? '课堂经验奖励' : '');
    }
    if (rewardType === 'gold' || rewardType === 'exp') {
      setRewardValue(10);
    } else {
      setRewardValue(null);
    }
    if ((rewardType === 'item' && items.length === 0)) {
      itemAPI.getItems().then((res: any) => setItems(res.data.items || [])).catch(() => {});
    }
    if ((rewardType === 'equipment' && equipments.length === 0)) {
      equipmentAPI.getAll().then((res: any) => setEquipments(res.data.equipments || [])).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewardType]);

  // 默认奖励原因（题目切换且未被手动修改时）
  useEffect(() => {
    if (!reasonTouched) {
      setRewardReason(questions.length > 0 ? `第${index + 1}题回答正确` : '课堂表现优秀');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // 切换题目时重置答题状态
  useEffect(() => {
    setJudgeResult(null);
    setAnswerText('');
    setAnswerer(null);
    stopSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // 自动播放
  useEffect(() => {
    if (!autoPlay || questions.length === 0) return;
    const t = setInterval(() => setIndex(i => Math.min(i + 1, questions.length - 1)), autoSeconds * 1000);
    return () => clearInterval(t);
  }, [autoPlay, autoSeconds, questions.length]);

  // 抢答倒计时
  useEffect(() => {
    if (buzzLeft === null || buzzLeft <= 0) return;
    const t = setTimeout(() => setBuzzLeft(v => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(t);
  }, [buzzLeft]);

  // AI评判已等待秒数
  useEffect(() => {
    if (!judging) return;
    setJudgeSeconds(0);
    const t = setInterval(() => setJudgeSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [judging]);

  // 键盘控制
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, Math.max(0, questions.length - 1)));
      else if (e.key === 'ArrowLeft') setIndex(i => Math.max(i - 1, 0));
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [questions.length, onClose]);

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s => {
      const name = (s.real_name || '').toLowerCase();
      const uname = (s.username || '').toLowerCase();
      if (name.includes(q) || uname.includes(q)) return true;
      const py = getPy(s);
      return py.full.includes(q) || py.initials.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, query]);

  const toggleRewardSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      filteredStudents.forEach(s => next.add(s.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // 将某个学生的卡片滚动到列表中间
  const scrollStudentIntoView = (id: number) => {
    setQuery(''); // 清空搜索，确保该学生显示在列表中
    setTimeout(() => {
      cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  };

  // 随机点名（自动绑定为答题人）
  const startRandomPick = () => {
    if (students.length === 0) { message.warning('班级暂无学生'); return; }
    setRandomState({ rolling: true, name: '', student: null });
    let ticks = 0;
    const totalTicks = 25;
    if (rollTimer.current) clearInterval(rollTimer.current);
    rollTimer.current = setInterval(() => {
      const s = students[Math.floor(Math.random() * students.length)];
      setRandomState({ rolling: true, name: s.real_name || s.username, student: null });
      ticks++;
      if (ticks >= totalTicks && rollTimer.current) {
        clearInterval(rollTimer.current);
        rollTimer.current = null;
        setRandomState({ rolling: false, name: s.real_name || s.username, student: s });
        setAnswerer(s);
        scrollStudentIntoView(s.id);
      }
    }, 90);
  };

  // ===== 语音录入 =====
  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      message.warning('当前浏览器不支持语音识别，请使用Chrome/Edge，或在输入框手动录入');
      return;
    }
    try {
      const rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e: any) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        setAnswerText(t);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recRef.current = rec;
      setListening(true);
      rec.start();
    } catch (e) {
      setListening(false);
    }
  };

  const stopListening = () => {
    try { recRef.current?.stop(); } catch (e) { /* 忽略 */ }
    setListening(false);
  };

  // ===== AI 评判 =====
  const handleJudge = async () => {
    if (!currentQuestion) return;
    if (!answerText.trim()) {
      message.warning('请先录入学生回答：点麦克风语音录入，或手动输入');
      return;
    }
    if (!answerer) {
      Modal.confirm({
        title: '请先确定答题人',
        content: '提交AI评判前需要确定是谁在回答。点击右侧学生卡片指定，或现在随机点名（自动绑定答题人）。',
        okText: '随机点名',
        cancelText: '我自己选',
        zIndex: 3000,
        onOk: () => startRandomPick(),
      });
      return;
    }
    setJudging(true);
    try {
      const res = await classroomQuizAPI.aiJudge({
        subject: quiz.subject,
        question_text: currentQuestion.question_text,
        student_answer: answerText,
      });
      const r = res.data;
      setJudgeResult({ ...r, student: answerer, answer: answerText, questionIndex: index, coins: 0 });
      try {
        const saved = await classroomQuizAPI.saveAnswer(quiz.id, {
          question_id: currentQuestion.id,
          student_id: answerer.id,
          answer_text: answerText,
          judged_by_ai: true,
          is_correct: r.is_correct,
          score: r.score,
          coin_rewarded: 0,
        });
        setJudgeResult((prev: any) => ({ ...prev, answerId: saved.data.answer_id }));
      } catch (e) { /* 记录失败不影响展示 */ }
      loadAnswers();
      stopSpeech();
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'AI评判失败');
    } finally {
      setJudging(false);
    }
  };

  // 按AI结果发放金币
  const handleRewardByResult = async () => {
    if (!judgeResult) return;
    const coins = Math.max(0, Math.round((judgeResult.score / 100) * perQValue));
    if (coins <= 0) {
      message.warning('按当前得分计算发放为0，可调大本题分值后再发');
      return;
    }
    try {
      await classroomQuizAPI.rewardStudent(quiz.id, {
        student_ids: [judgeResult.student.id],
        reward_type: 'gold',
        reward_value: coins,
        reward_name: '课堂答题奖励',
        question_id: currentQuestion?.id,
        reason: `第${judgeResult.questionIndex + 1}题AI评判${judgeResult.score}分`,
      });
      message.success(`已向 ${judgeResult.student.real_name || judgeResult.student.username} 发放 ${coins} 金币`);
      setJudgeResult((r: any) => ({ ...r, coins }));
      // 把金币数额回填到该条答题记录
      if (judgeResult.answerId) {
        try { await classroomQuizAPI.updateAnswerReward(judgeResult.answerId, coins); } catch (e) { /* 忽略 */ }
      }
      loadAnswers();
      onRewarded();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '发放失败');
    }
  };

  // 批量发放奖励（奖励栏，发给所有勾选学生）
  const handleReward = async () => {
    if (selectedIds.size === 0) { message.warning('请先勾选学生（学生卡片上的勾选框）'); return; }
    if (rewardValue === null || rewardValue === undefined || rewardValue <= 0) {
      message.warning(rewardType === 'item' || rewardType === 'equipment' ? '请选择物品/装备' : '请填写奖励数值');
      return;
    }
    setRewarding(true);
    try {
      await classroomQuizAPI.rewardStudent(quiz.id, {
        student_ids: Array.from(selectedIds),
        reward_type: rewardType,
        reward_value: rewardValue,
        reward_name: rewardName || undefined,
        question_id: currentQuestion?.id || undefined,
        reason: rewardReason || undefined,
      });
      message.success(`已向 ${selectedIds.size} 名学生发放奖励`);
      setSelectedIds(new Set());
      onRewarded();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '发放失败');
    } finally {
      setRewarding(false);
    }
  };

  const renderStudentCard = (s: any) => {
    const selected = selectedIds.has(s.id);
    const isAnswerer = answerer?.id === s.id;
    return (
      <div
        key={s.id}
        ref={(el) => { cardRefs.current[s.id] = el; }}
        onClick={() => { setAnswerer(s); setJudgeResult(null); setAnswerText(''); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
          borderRadius: 8, cursor: 'pointer', marginBottom: 6,
          background: isAnswerer ? '#113a1f' : selected ? '#15325b' : '#1f1f1f',
          border: isAnswerer ? '2px solid #52c41a' : selected ? '2px solid #1890ff' : '1px solid #333',
        }}
        title="点击设为答题人"
      >
        <Checkbox
          checked={selected}
          onChange={() => toggleRewardSelect(s.id)}
          onClick={(e) => e.stopPropagation()}
        />
        {s.pet_id ? (
          <img src={getPetThumbUrl(s)} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'contain' }} />
        ) : (
          <Avatar icon={<UserSwitchOutlined />} size={32} style={{ background: '#333' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.real_name || s.username}
            {isAnswerer && <Tag color="green" style={{ marginLeft: 6 }}>答题中</Tag>}
          </div>
          {s.pet_name && (
            <div style={{ color: '#888', fontSize: 11 }}>
              {s.pet_name} Lv.{s.pet_level}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ===== 主区内容 =====
  const mainArea = () => {
    if (judgeResult) {
      const coins = Math.max(0, Math.round((judgeResult.score / 100) * perQValue));
      const resultText = `${judgeResult.student.real_name || judgeResult.student.username}同学，${judgeResult.is_correct ? '回答正确' : '回答不够准确'}，得分${judgeResult.score}分。${judgeResult.comment}${judgeResult.correct_answer ? ` 正确答案是：${judgeResult.correct_answer}。` : ''}`;
      return (
        <div style={{ textAlign: 'center', width: '100%', padding: '0 24px' }}>
          <div style={{ color: '#aaa', fontSize: 'clamp(16px, 1.8vw, 24px)', marginBottom: 8 }}>
            第 {judgeResult.questionIndex + 1} 题 · 答题人
          </div>
          <div style={{ color: '#fff', fontSize: `calc(clamp(30px, 4vw, 56px) * ${fontScale})`, fontWeight: 'bold' }}>
            {judgeResult.student.real_name || judgeResult.student.username}
          </div>
          <div style={{ margin: '20px 0' }}>
            {judgeResult.is_correct
              ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 'clamp(48px, 5vw, 80px)' }} />
              : <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 'clamp(48px, 5vw, 80px)' }} />}
            <span style={{ color: judgeResult.is_correct ? '#52c41a' : '#ff4d4f', fontSize: `calc(clamp(56px, 8vw, 110px) * ${fontScale})`, fontWeight: 'bold', marginLeft: 20 }}>
              {judgeResult.score}分
            </span>
          </div>
          <div style={{ color: '#ddd', fontSize: `calc(clamp(18px, 2.4vw, 32px) * ${fontScale})`, maxWidth: 900, margin: '0 auto' }}>{judgeResult.comment}</div>
          {judgeResult.correct_answer && (
            <div style={{
              color: '#bae637', fontSize: `calc(clamp(18px, 2.2vw, 30px) * ${fontScale})`, maxWidth: 900, margin: '16px auto 0',
              background: '#1c2b12', border: '1px solid #3a5318', borderRadius: 8, padding: '10px 16px'
            }}>
              正确答案：{judgeResult.correct_answer}
            </div>
          )}
          <div style={{ color: '#888', fontSize: 'clamp(14px, 1.6vw, 20px)', marginTop: 12 }}>回答：{judgeResult.answer}</div>
          <Space style={{ marginTop: 24 }} wrap>
            {judgeResult.coins > 0 ? (
              <Tag color="gold" style={{ fontSize: 16, padding: '4px 12px' }}>已发放 {judgeResult.coins} 金币</Tag>
            ) : (
              <Button type="primary" icon={<GiftOutlined />} onClick={handleRewardByResult}>
                按结果发放 {coins} 金币（本题值{perQValue}）
              </Button>
            )}
            {!speaking ? (
              <Button icon={<SoundOutlined />} onClick={() => speakText(resultText)}>朗读结果</Button>
            ) : paused ? (
              <Button icon={<PlayCircleOutlined />} onClick={resumeSpeech}>继续朗读</Button>
            ) : (
              <Button icon={<PauseCircleOutlined />} onClick={pauseSpeech}>暂停朗读</Button>
            )}
            {speaking && <Button icon={<StopOutlined />} onClick={stopSpeech}>停止</Button>}
            <Button onClick={() => { stopSpeech(); setJudgeResult(null); setAnswerText(''); }}>继续答题</Button>
          </Space>
        </div>
      );
    }
    if (randomState) {
      return (
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#aaa', fontSize: 'clamp(16px, 2vw, 26px)', marginBottom: 16 }}>
            {randomState.rolling ? '随机点名中...' : '被点到的同学是'}
          </div>
          <div style={{ color: randomState.rolling ? '#999' : '#1890ff', fontSize: `calc(clamp(56px, 10vw, 140px) * ${fontScale})`, fontWeight: 'bold' }}>
            {randomState.name || '...'}
          </div>
          {!randomState.rolling && (
            <Space style={{ marginTop: 24 }}>
              <Button onClick={startRandomPick} icon={<ReloadOutlined />}>再来一次</Button>
              <Button onClick={() => setRandomState(null)}>开始答题</Button>
            </Space>
          )}
        </div>
      );
    }
    if (buzzLeft !== null && buzzLeft > 0) {
      return (
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#52c41a', fontSize: 22, marginBottom: 8 }}>抢答计时中！</div>
          <div style={{ color: '#52c41a', fontSize: 150, fontWeight: 'bold', lineHeight: 1 }}>{buzzLeft}</div>
          <Button
            danger
            size="large"
            icon={<StopOutlined />}
            style={{ marginTop: 24 }}
            onClick={() => setBuzzLeft(null)}
          >
            提前结束（有人举手了）
          </Button>
        </div>
      );
    }
    if (buzzLeft === 0) {
      return (
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#ff4d4f', fontSize: 110, fontWeight: 'bold' }}>时间到！</div>
          <Space style={{ marginTop: 24 }}>
            <Button size="large" onClick={() => setBuzzLeft(null)}>返回题目</Button>
            <Button size="large" type="primary" danger icon={<ThunderboltOutlined />} onClick={() => setBuzzLeft(buzzTotal)}>
              再来一轮
            </Button>
          </Space>
        </div>
      );
    }
    return (
      <div style={{ textAlign: 'center', width: '100%' }}>
        <div style={{ color: '#666', fontSize: 'clamp(16px, 1.8vw, 24px)', marginBottom: 12 }}>
          第 {index + 1} / {questions.length} 题
          {autoPlay && <Tag color="blue" style={{ marginLeft: 12 }}>自动播放中</Tag>}
          {answerer && <Tag color="green" style={{ marginLeft: 12 }}>答题人：{answerer.real_name || answerer.username}</Tag>}
        </div>
        <div style={{ color: '#fff', fontSize: `calc(clamp(30px, 4.5vw, 64px) * ${fontScale})`, fontWeight: 500, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {currentQuestion?.question_text || '暂无题目'}
        </div>
        {/* 朗读控制 */}
        <Space style={{ marginTop: 16 }} wrap>
          {!speaking ? (
            <Button icon={<SoundOutlined />} onClick={() => speakText()}>朗读题目</Button>
          ) : paused ? (
            <Button icon={<PlayCircleOutlined />} onClick={resumeSpeech}>继续朗读</Button>
          ) : (
            <Button icon={<PauseCircleOutlined />} onClick={pauseSpeech}>暂停朗读</Button>
          )}
          {speaking && <Button icon={<StopOutlined />} onClick={stopSpeech}>停止</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => speakText()}>重读</Button>
          {voices.length > 0 && (
            <Select
              size="small"
              style={{ width: 260 }}
              value={voiceURI || voices.find(v => /yunxi|云希/i.test(v.name))?.voiceURI || voices.find(v => /^zh/i.test(v.lang))?.voiceURI || voices[0]?.voiceURI}
              onChange={(v) => { setVoiceURI(v); localStorage.setItem('cls_tts_voice', v); }}
              options={voices.map(v => ({ value: v.voiceURI, label: `${v.name}（${v.lang}）` }))}
              placeholder="朗读声音"
            />
          )}
          <Button size="small" icon={<ReloadOutlined />} onClick={loadVoices} title="重新加载系统语音列表">刷新声音</Button>
          <span style={{ color: '#666', fontSize: 12 }}>共{voices.length}个</span>
          {voices.length === 0 && <span style={{ color: '#666', fontSize: 12 }}>未检测到语音，请点刷新声音</span>}
        </Space>
      </div>
    );
  };

  // 汇总数据（基于本课堂全部持久化记录）
  const summaryByStudent = useMemo(() => {
    const map = new Map<number, { name: string; count: number; correct: number; totalScore: number; coins: number }>();
    for (const a of records) {
      const key = a.student_id;
      const item = map.get(key) || { name: a.student_name, count: 0, correct: 0, totalScore: 0, coins: 0 };
      item.count++;
      if (a.is_correct) item.correct++;
      item.totalScore += a.score || 0;
      item.coins += a.coin_rewarded || 0;
      map.set(key, item);
    }
    return Array.from(map.values());
  }, [records]);

  return (
    <div className="cc-dark" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#141414', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
      {/* 深色主题下修正 antd 输入控件配色 */}
      <style>{`
        .cc-dark .ant-input-number { background: #1f1f1f; border-color: #444; }
        .cc-dark .ant-input-number-group-addon { background: #2a2a2a; color: #ccc; border-color: #444; }
        .cc-dark .ant-input-number-input { color: #fff; }
        .cc-dark .ant-input-affix-wrapper { background: #1f1f1f; border-color: #444; }
        .cc-dark .ant-input, .cc-dark input.ant-input { background: transparent; color: #fff; }
        .cc-dark input::placeholder { color: #666; }
        .cc-dark textarea::placeholder { color: #666; }
        .cc-dark .ant-select-selector { background: #1f1f1f !important; border-color: #444 !important; }
        .cc-dark .ant-select-selection-item { color: #eee; }
        .cc-dark .ant-select-arrow { color: #999; }
        .cc-dark .ant-btn-primary:disabled, .cc-dark .ant-btn-primary.ant-btn-disabled {
          background: #3a3a3a !important; color: #fff !important; border-color: #555 !important;
        }
        .cc-dark .ant-slider-track { background: #1890ff; }
        .cc-dark .ant-slider-rail { background: #333; }
      `}</style>

      {/* 顶栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #333' }}>
        <div style={{ color: '#ccc', fontSize: 15 }}>
          <span style={{ color: '#fff', fontWeight: 500 }}>{quiz.title}</span>
          <span style={{ marginLeft: 12 }}>{quiz.class_name || ''}</span>
          <span style={{ marginLeft: 12, color: '#888' }}>课堂控制台（←/→ 翻题，Esc 退出）</span>
        </div>
        <Space>
          <Button icon={<BarChartOutlined />} onClick={() => setSummaryOpen(true)}>课堂总结（{records.length}条）</Button>
          <Button icon={<CloseOutlined />} ghost onClick={onClose}>退出控制台</Button>
        </Space>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：题目 + 答题 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0,
            WebkitOverflowScrolling: 'touch', padding: '12px 16px'
          }}>
            <div style={{ margin: 'auto', width: '100%' }}>
              {mainArea()}
            </div>

            {/* 答题录入栏（展示结果时隐藏） */}
            {!judgeResult && !randomState && buzzLeft === null && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', borderTop: '1px solid #333', paddingTop: 10, marginTop: 10 }}>
                <div>
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>本题分值（金币）</div>
                  <InputNumber min={1} max={1000} value={perQValue} onChange={(v) => setPerQValue(v || 10)} style={{ width: 110 }} />
                </div>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>
                    学生回答（点麦克风录入，或手动输入）
                    {answerer && <span style={{ color: '#52c41a', marginLeft: 8 }}>答题人：{answerer.real_name || answerer.username}</span>}
                  </div>
                  <Input
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    placeholder="学生口头回答的内容..."
                    suffix={
                      <Button
                        size="small"
                        type={listening ? 'primary' : 'default'}
                        danger={listening}
                        icon={<AudioOutlined />}
                        onClick={listening ? stopListening : startListening}
                      >
                        {listening ? '停止录音' : '语音录入'}
                      </Button>
                    }
                  />
                </div>
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={judging}
                  onClick={handleJudge}
                >
                  {judging ? `AI评判中... 已等待${judgeSeconds}秒` : '提交AI评判'}
                </Button>
              </div>
            )}
          </div>

          {/* 题目控制条 */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 16px' }}>
            <Button icon={<LeftOutlined />} onClick={() => setIndex(i => Math.max(i - 1, 0))}>上一题</Button>
            <Button onClick={() => setIndex(i => Math.min(i + 1, questions.length - 1))}>下一题 <RightOutlined /></Button>
            <span style={{ color: '#555' }}>|</span>
            <Checkbox checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} style={{ color: '#aaa' }}>自动播放</Checkbox>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#aaa', fontSize: 12 }}>字号</span>
              <Slider
                min={0.7}
                max={1.8}
                step={0.1}
                value={fontScale}
                onChange={(v) => { setFontScale(v); localStorage.setItem('cls_font_scale', String(v)); }}
                style={{ width: 120, margin: 0 }}
                tooltip={{ formatter: (v) => `${Math.round((v || 1) * 100)}%` }}
              />
            </span>
            <span>
              <InputNumber min={5} max={300} value={autoSeconds} onChange={(v) => setAutoSeconds(v || 30)} style={{ width: 90 }} />
              <span style={{ color: '#aaa', marginLeft: 4, fontSize: 12 }}>秒/题</span>
            </span>
            <span>
              <InputNumber min={5} max={300} value={buzzTotal} onChange={(v) => setBuzzTotal(v || 30)} style={{ width: 90 }} />
              <span style={{ color: '#aaa', marginLeft: 4, fontSize: 12 }}>秒抢答</span>
            </span>
            <Button type="primary" danger icon={<ThunderboltOutlined />} onClick={() => { setAutoPlay(false); setRandomState(null); setJudgeResult(null); setBuzzLeft(buzzTotal); }}>
              开始抢答
            </Button>
            <Button icon={<UserSwitchOutlined />} onClick={startRandomPick}>随机点名</Button>
          </div>
        </div>

        {/* 右侧：学生面板 + 奖励栏 */}
        <div style={{ width: 400, borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 搜索 + 小键盘 */}
          <div style={{ padding: 12, background: '#1a1f29', borderBottom: '1px solid #2a3040' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Input
                placeholder="姓名/拼音首字母/用户名"
                prefix={<SearchOutlined style={{ color: '#999' }} />}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                allowClear
              />
              <Button icon={<DeleteOutlined />} onClick={() => setQuery('')} title="清空搜索" />
            </div>
            {/* 屏幕小键盘（QWERTY布局） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {KEYPAD_ROWS.map((row, ri) => (
                <div key={ri} style={{ display: 'flex', gap: 4 }}>
                  {row.map(k => (
                    <Button key={k} size="small" style={{ flex: 1 }} onClick={() => setQuery(q => q + k)}>
                      {k.toUpperCase()}
                    </Button>
                  ))}
                  {ri === 2 && (
                    <Button size="small" style={{ flex: 2 }} icon={<DeleteOutlined />} onClick={() => setQuery(q => q.slice(0, -1))} title="退格" />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: '#888', fontSize: 12 }}>
              <span>已选 {selectedIds.size} 人 / 共 {students.length} 人（点卡片=定答题人）</span>
              <span>
                <a style={{ color: '#1890ff' }} onClick={selectAllFiltered}>全选</a>
                <span style={{ margin: '0 6px' }}>|</span>
                <a style={{ color: '#1890ff' }} onClick={clearSelection}>清空</a>
              </span>
            </div>
          </div>

          {/* 学生列表 */}
          <div style={{ flex: 1, overflow: 'auto', padding: 12, background: '#101216' }}>
            <Spin spinning={studentsLoading}>
              {filteredStudents.length > 0 ? (
                filteredStudents.map(renderStudentCard)
              ) : (
                <Empty description={students.length === 0 ? '暂无学生' : '没有匹配的学生'} />
              )}
            </Spin>
          </div>

          {/* 奖励栏（学生列表下方） */}
          <div style={{ borderTop: '1px solid #2a3040', padding: 12, background: '#20242e' }}>
            <div style={{ color: '#ccc', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
              <GiftOutlined style={{ marginRight: 6 }} />发放奖励
              {selectedIds.size > 0 && <Tag color="blue" style={{ marginLeft: 8 }}>已选{selectedIds.size}人</Tag>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Select
                value={rewardType}
                style={{ flex: 1 }}
                onChange={setRewardType}
                options={Object.entries(REWARD_TYPES).map(([k, v]) => ({ value: k, label: v }))}
              />
              {rewardType === 'item' || rewardType === 'equipment' ? (
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ flex: 2 }}
                  placeholder="选择物品/装备"
                  loading={rewardType === 'item' ? items.length === 0 : equipments.length === 0}
                  value={rewardValue ?? undefined}
                  options={rewardType === 'item'
                    ? items.map((it: any) => ({ value: it.id, label: `${it.name}（${it.price ?? '-'}金币）`, name: it.name }))
                    : equipments.map((eq: any) => ({ value: eq.id, label: `${eq.name}（${rarityLabel(eq.rarity)}）`, name: eq.name }))}
                  onSelect={(_, opt: any) => {
                    setRewardValue(opt.value);
                    if (!nameTouched) setRewardName(opt.name);
                  }}
                />
              ) : (
                <>
                  <InputNumber min={1} max={999999} value={rewardValue} onChange={(v) => setRewardValue(v)} style={{ width: 110 }} />
                  <Space size={4}>
                    {QUICK_AMOUNTS.map(n => (
                      <Button key={n} size="small" onClick={() => setRewardValue(n)}>{n}</Button>
                    ))}
                  </Space>
                </>
              )}
            </div>
            <Input
              value={rewardName}
              onChange={(e) => { setRewardName(e.target.value); setNameTouched(true); }}
              placeholder="奖励名称（自动填，可改）"
              maxLength={50}
              style={{ marginBottom: 8 }}
            />
            <Input
              value={rewardReason}
              onChange={(e) => { setRewardReason(e.target.value); setReasonTouched(true); }}
              placeholder="奖励原因（自动填，可改）"
              maxLength={100}
              style={{ marginBottom: 8 }}
            />
            <Button
              type="primary"
              icon={<GiftOutlined />}
              loading={rewarding}
              disabled={selectedIds.size === 0}
              onClick={handleReward}
              block
            >
              发奖励给已选的 {selectedIds.size} 名学生
            </Button>
          </div>
        </div>
      </div>

      {/* 课堂总结 */}
      <Modal
        title={`课堂总结：${quiz.title}`}
        open={summaryOpen}
        zIndex={3000}
        onCancel={() => setSummaryOpen(false)}
        footer={<Button type="primary" onClick={() => setSummaryOpen(false)}>关闭</Button>}
        width={760}
      >
        {records.length === 0 ? (
          <Empty description="本课堂还没有答题记录" />
        ) : (
          <>
            <Table
              dataSource={records.map((a, i) => ({ ...a, key: i }))}
              columns={[
                { title: '题号', width: 70, render: (_: any, r: any) => `第${r.questionIndex + 1}题` },
                { title: '答题人', dataIndex: 'student_name', width: 90 },
                { title: '回答', dataIndex: 'answer_text', ellipsis: true },
                { title: '判定', width: 80, render: (_: any, r: any) => r.is_correct ? <Tag color="green">正确</Tag> : <Tag color="red">错误</Tag> },
                { title: '得分', width: 70, render: (v: number) => `${v ?? 0}分` },
                { title: '金币', width: 70, render: (v: number) => v > 0 ? `+${v}` : '-' },
              ]}
              pagination={{ pageSize: 8 }}
              size="small"
              style={{ marginBottom: 16 }}
            />
            <Table
              dataSource={summaryByStudent.map((s, i) => ({ ...s, key: i }))}
              columns={[
                { title: '学生', dataIndex: 'name' },
                { title: '答题次数', dataIndex: 'count', width: 100 },
                { title: '答对', dataIndex: 'correct', width: 80 },
                { title: '平均得分', width: 100, render: (_: any, r: any) => r.count > 0 ? `${Math.round(r.totalScore / r.count)}分` : '-' },
                { title: '获得金币', width: 100, render: (_: any, r: any) => r.coins > 0 ? `+${r.coins}` : '-' },
              ]}
              pagination={false}
              size="small"
              title={() => '按学生汇总'}
            />
            <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
              答题记录已保存到各学生的课堂答题档案中；金币发放以实际发放记录为准。
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

export default ClassroomConsole;
