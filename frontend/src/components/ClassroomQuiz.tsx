import React, { useEffect, useRef, useState } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Select, InputNumber,
  message, Space, Tag, Tabs, Descriptions, Row, Col, Typography,
  List, Avatar, Popconfirm, Empty, Badge, Spin, Radio, Checkbox, Alert
} from 'antd';
import {
  PlusOutlined, GiftOutlined, CheckCircleOutlined,
  UserOutlined, EyeOutlined, PlayCircleOutlined, RobotOutlined,
  UserSwitchOutlined, SearchOutlined
} from '@ant-design/icons';
import { classroomQuizAPI, questionBankAPI, itemAPI, equipmentAPI, adminAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { getPetThumbUrl } from '../utils/petImage';
import ClassroomConsole from './ClassroomConsole';

const { Title, Text, Paragraph } = Typography;

const REWARD_TYPES: Record<string, { label: string; color: string }> = {
  gold: { label: '金币', color: 'gold' },
  item: { label: '物品', color: 'green' },
  equipment: { label: '装备', color: 'blue' },
  exp: { label: '经验', color: 'orange' },
};

const subjectOptions = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '其他'];
const aiTypeOptions = [
  { value: 'choice_single', label: '单选题' },
  { value: 'choice_multi', label: '多选题' },
  { value: 'judgment', label: '判断题' },
  { value: 'essay', label: '简答题' }
];

const statusMap: Record<string, { color: string; label: string }> = {
  active: { color: 'processing', label: '进行中' },
  completed: { color: 'success', label: '已完成' },
  cancelled: { color: 'default', label: '已取消' },
};

const renderStatus = (s: string) => (
  <Badge status={statusMap[s]?.color as any} text={statusMap[s]?.label || s} />
);

const ClassroomQuiz: React.FC = () => {
  const { currentClass } = useAuthStore();
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const [selectedQuiz, setSelectedQuiz] = useState<any>(null);
  const [quizDetail, setQuizDetail] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [rewards, setRewards] = useState<any[]>([]);
  const [answers, setAnswers] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rewarding, setRewarding] = useState(false);
  const [createForm] = Form.useForm();
  const [rewardForm] = Form.useForm();
  const rewardType = Form.useWatch('reward_type', rewardForm);
  const aiMode = Form.useWatch('ai_mode', createForm) || 'topic';

  // 创建：班级 / 题目来源
  const [classes, setClasses] = useState<any[]>([]);
  const [createSource, setCreateSource] = useState<'manual' | 'bank' | 'ai'>('manual');

  // 题库选题
  const [bankQuestions, setBankQuestions] = useState<any[]>([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankPage, setBankPage] = useState(1);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankSubject, setBankSubject] = useState<string | undefined>(undefined);
  const [bankKeyword, setBankKeyword] = useState('');
  const [selectedBankIds, setSelectedBankIds] = useState<number[]>([]);

  // AI 快速出题
  const [aiLoading, setAiLoading] = useState(false);
  const [aiQuestions, setAiQuestions] = useState<any[]>([]);
  const [aiSelected, setAiSelected] = useState<Set<number>>(new Set());

  // 奖励：物品 / 装备列表
  const [items, setItems] = useState<any[]>([]);
  const [equipments, setEquipments] = useState<any[]>([]);

  // AI生成次数额度（与发布作业共用）
  const [genLimit, setGenLimit] = useState<{ daily_limit: number; daily_used: number; daily_remaining: number; global_tokens_remaining: number } | null>(null);

  // 随机点名
  const [randomOpen, setRandomOpen] = useState(false);
  const [randomRolling, setRandomRolling] = useState(false);
  const [randomName, setRandomName] = useState('');
  const [pickedStudent, setPickedStudent] = useState<any>(null);
  const rollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 课堂控制台
  const [consoleData, setConsoleData] = useState<{ quiz: any; questions: any[] } | null>(null);

  useEffect(() => {
    loadQuizzes();
    loadClasses();
    loadGenLimit();
  }, []);

  useEffect(() => {
    return () => { if (rollTimer.current) clearInterval(rollTimer.current); };
  }, []);

  // 奖励类型为物品/装备时，懒加载对应列表
  useEffect(() => {
    if (rewardModalOpen && rewardType === 'item' && items.length === 0) {
      itemAPI.getItems().then((res: any) => setItems(res.data.items || [])).catch(() => {});
    }
    if (rewardModalOpen && rewardType === 'equipment' && equipments.length === 0) {
      equipmentAPI.getAll().then((res: any) => setEquipments(res.data.equipments || [])).catch(() => {});
    }
  }, [rewardModalOpen, rewardType]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
    } catch (e) {
      console.error('加载班级列表失败');
    }
  };

  const loadGenLimit = async () => {
    try {
      const res = await adminAPI.getMyGenLimit();
      setGenLimit(res.data);
    } catch (e) {
      // 静默
    }
  };

  const loadQuizzes = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (currentClass?.id) params.class_id = currentClass.id;
      const res = await classroomQuizAPI.getQuizzes(params);
      setQuizzes(res.data.quizzes || []);
    } catch (e) {
      console.error('加载课堂做题失败:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadBank = async (page = 1) => {
    setBankLoading(true);
    try {
      const res = await questionBankAPI.getQuestions({
        page,
        pageSize: 10,
        subject: bankSubject || undefined,
        keyword: bankKeyword || undefined,
      });
      setBankQuestions(res.data.questions || []);
      setBankTotal(res.data.total || 0);
      setBankPage(page);
    } catch (e) {
      message.error('加载题库失败');
    } finally {
      setBankLoading(false);
    }
  };

  const handleSourceChange = (source: 'manual' | 'bank' | 'ai') => {
    setCreateSource(source);
    if (source === 'bank' && bankQuestions.length === 0) {
      loadBank(1);
    }
  };

  const handleGenerateAI = async () => {
    const values = createForm.getFieldsValue(['subject', 'ai_mode', 'ai_topic', 'ai_requirements', 'ai_raw_text', 'ai_type', 'ai_count', 'ai_difficulty']);
    if (!values.subject) { message.warning('请先选择科目'); return; }
    const mode = values.ai_mode || 'topic';
    const payload: any = {
      subject: values.subject,
      question_type: values.ai_type || 'choice_single',
      count: values.ai_count || 5,
      difficulty: values.ai_difficulty || 'medium',
      mode,
    };
    if (mode === 'topic') {
      if (!values.ai_topic) { message.warning('请输入知识点主题'); return; }
      payload.topic = values.ai_topic;
    } else if (mode === 'requirements') {
      if (!values.ai_requirements || !values.ai_requirements.trim()) { message.warning('请填写详细的出题要求'); return; }
      payload.requirements = values.ai_requirements;
    } else {
      if (!values.ai_raw_text || !values.ai_raw_text.trim()) { message.warning('请粘贴题目内容'); return; }
      payload.raw_text = values.ai_raw_text;
    }
    setAiLoading(true);
    try {
      const res = await classroomQuizAPI.aiGenerate(payload);
      setAiQuestions(res.data.questions || []);
      setAiSelected(new Set((res.data.questions || []).map((_: any, i: number) => i)));
      message.success(`AI整理出 ${res.data.questions?.length || 0} 道题目，请勾选要使用的题目`);
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'AI出题失败');
    } finally {
      setAiLoading(false);
      loadGenLimit();
    }
  };

  const handleCreate = async (values: any) => {
    try {
      let questions: { question_text: string }[] = [];

      if (createSource === 'manual') {
        questions = (values.question_texts || '')
          .split('\n')
          .filter((line: string) => line.trim())
          .map((text: string) => ({ question_text: text.trim() }));
      } else if (createSource === 'bank') {
        if (selectedBankIds.length === 0) {
          message.warning('请先从题库中勾选题目');
          return;
        }
        questions = selectedBankIds
          .sort((a, b) => a - b)
          .map(id => {
            const q = bankQuestions.find(b => b.id === id);
            const lines = [q?.content || ''];
            if (q?.options && Array.isArray(q.options) && q.options.length > 0) {
              q.options.forEach((opt: string, i: number) => {
                lines.push(`${String.fromCharCode(65 + i)}. ${opt}`);
              });
            }
            return { question_text: lines.filter(Boolean).join('\n') };
          });
      } else {
        if (aiSelected.size === 0) {
          message.warning('请先点击"AI生成题目"并勾选要使用的题目');
          return;
        }
        questions = aiQuestions
          .filter((_, i) => aiSelected.has(i))
          .map(q => ({ question_text: q.content }));
      }

      if (questions.length === 0) {
        message.warning('请至少准备一道题目');
        return;
      }

      await classroomQuizAPI.createQuiz({
        title: values.title,
        description: values.description,
        subject: values.subject,
        class_id: values.class_id || currentClass?.id,
        questions,
      });

      message.success('课堂做题创建成功');
      setCreateModalOpen(false);
      createForm.resetFields();
      setCreateSource('manual');
      setSelectedBankIds([]);
      setAiQuestions([]);
      setAiSelected(new Set());
      loadQuizzes();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '创建失败');
    }
  };

  const handleViewDetail = async (quiz: any) => {
    setSelectedQuiz(quiz);
    setDetailModalOpen(true);
    setDetailLoading(true);
    try {
      const res = await classroomQuizAPI.getQuizDetail(quiz.id);
      setQuizDetail(res.data.quiz);
      setQuestions(res.data.questions || []);
      setRewards(res.data.rewards || []);
      setAnswers(res.data.answers || []);
    } catch (e) {
      console.error('加载详情失败:', e);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCompleteQuiz = async (quizId: number) => {
    try {
      await classroomQuizAPI.updateQuizStatus(quizId, 'completed');
      message.success('课堂做题已结束');
      loadQuizzes();
      if (detailModalOpen) {
        handleViewDetail(selectedQuiz);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '操作失败');
    }
  };

  // 进入课堂控制台
  const handleOpenConsole = async (quiz: any) => {
    try {
      const res = await classroomQuizAPI.getQuizDetail(quiz.id);
      const qs = res.data.questions || [];
      if (qs.length === 0) {
        message.warning('该课堂做题暂无题目，请先添加题目');
        return;
      }
      setDetailModalOpen(false);
      setConsoleData({ quiz: res.data.quiz || quiz, questions: qs });
    } catch (e) {
      message.error('加载课堂做题失败');
    }
  };

  // 随机点名
  const startRandomPick = async () => {
    let pool = students;
    try {
      const res = await classroomQuizAPI.getClassStudents(currentClass?.id || selectedQuiz?.class_id);
      pool = res.data.students || [];
      setStudents(pool);
    } catch (e) {
      // 拉取失败时用已有列表
    }
    if (!pool || pool.length === 0) {
      message.warning('班级暂无学生，无法随机点名');
      return;
    }
    setRandomOpen(true);
    setRandomRolling(true);
    setPickedStudent(null);
    let ticks = 0;
    const totalTicks = 25;
    if (rollTimer.current) clearInterval(rollTimer.current);
    rollTimer.current = setInterval(() => {
      const s = pool[Math.floor(Math.random() * pool.length)];
      setRandomName(s.real_name || s.username);
      ticks++;
      if (ticks >= totalTicks && rollTimer.current) {
        clearInterval(rollTimer.current);
        rollTimer.current = null;
        setRandomRolling(false);
        setPickedStudent(s);
      }
    }, 90);
  };

  const handleRewardPicked = () => {
    if (!pickedStudent) return;
    setRandomOpen(false);
    setSelectedStudent(pickedStudent);
    setSelectedQuestionId(null);
    setRewardModalOpen(true);
    rewardForm.resetFields();
  };

  const handleOpenReward = async (quiz: any, questionId: number | null = null, preStudent: any = null) => {
    setSelectedQuiz(quiz);
    setSelectedQuestionId(questionId);
    setRewardModalOpen(true);
    rewardForm.resetFields();
    if (preStudent) {
      setSelectedStudent(preStudent);
    } else {
      setSelectedStudent(null);
    }

    try {
      const res = await classroomQuizAPI.getClassStudents(currentClass?.id || quiz.class_id);
      setStudents(res.data.students || []);
    } catch (e) {
      console.error('加载学生失败:', e);
    }
  };

  const handleReward = async (values: any) => {
    if (!selectedStudent) {
      message.warning('请选择一个学生');
      return;
    }

    setRewarding(true);
    try {
      await classroomQuizAPI.rewardStudent(selectedQuiz.id, {
        student_id: selectedStudent.id,
        pet_id: selectedStudent.pet_id || undefined,
        reward_type: values.reward_type,
        reward_value: values.reward_value,
        reward_name: values.reward_name || undefined,
        question_id: selectedQuestionId || undefined,
        reason: values.reason || undefined,
      });

      message.success(`已向 ${selectedStudent.real_name || selectedStudent.username} 发放奖励`);
      setRewardModalOpen(false);
      setSelectedStudent(null);
      setSelectedQuestionId(null);

      if (detailModalOpen) {
        handleViewDetail(selectedQuiz);
      }
      loadQuizzes();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '发放失败');
    } finally {
      setRewarding(false);
    }
  };

  const quizColumns = [
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '科目', dataIndex: 'subject', key: 'subject', render: (v: string) => v || '-' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name' },
    { title: '题目数', dataIndex: 'question_count', key: 'question_count' },
    { title: '奖励次数', dataIndex: 'reward_count', key: 'reward_count' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => renderStatus(s)
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(r)}>详情</Button>
          {r.status === 'active' && (
            <>
              <Button type="link" size="small" icon={<PlayCircleOutlined />} onClick={() => handleOpenConsole(r)}>控制台</Button>
              <Button type="link" size="small" icon={<GiftOutlined />} onClick={() => handleOpenReward(r)}>奖励</Button>
              <Popconfirm title="确定结束此课堂做题？" onConfirm={() => handleCompleteQuiz(r.id)}>
                <Button type="link" size="small" icon={<CheckCircleOutlined />}>结束</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      )
    },
  ];

  const rewardColumns = [
    { title: '学生', dataIndex: 'student_name', key: 'student_name' },
    { title: '宠物', dataIndex: 'pet_name', key: 'pet_name', render: (v: string) => v || '-' },
    {
      title: '奖励类型', dataIndex: 'reward_type', key: 'reward_type',
      render: (t: string) => <Tag color={REWARD_TYPES[t]?.color}>{REWARD_TYPES[t]?.label || t}</Tag>
    },
    {
      title: '奖励内容', key: 'reward_content',
      render: (_: any, r: any) => r.reward_name || `${r.reward_type} x${r.reward_value}`
    },
    { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
    { title: '发放者', dataIndex: 'awarder_name', key: 'awarder_name' },
    {
      title: '时间', dataIndex: 'awarded_at', key: 'awarded_at',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
  ];

  const bankColumns = [
    { title: '题干', dataIndex: 'content', key: 'content', ellipsis: true },
    { title: '知识点', dataIndex: 'knowledge_point', key: 'knowledge_point', ellipsis: true, width: 160 },
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 70, render: (v: string) => ({ easy: '简单', medium: '中等', hard: '困难' }[v] || v) },
  ];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <PlayCircleOutlined style={{ marginRight: 8 }} />
          课堂做题
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          创建课堂做题
        </Button>
      </div>

      <Table
        dataSource={quizzes}
        columns={quizColumns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 个课堂做题` }}
        size="middle"
      />

      {/* 创建课堂做题 */}
      <Modal
        title="创建课堂做题"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); setCreateSource('manual'); setSelectedBankIds([]); setAiQuestions([]); setAiSelected(new Set()); }}
        onOk={() => createForm.submit()}
        width={760}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Row gutter={16}>
            <Col span={10}>
              <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                <Input placeholder="如：第三单元随堂练习" />
              </Form.Item>
            </Col>
            <Col span={7}>
              <Form.Item name="class_id" label="班级" initialValue={currentClass?.id} rules={[{ required: true, message: '请选择班级' }]}>
                <Select placeholder="选择班级" showSearch optionFilterProp="children">
                  {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={7}>
              <Form.Item name="subject" label="科目">
                <Select placeholder="选择科目" allowClear>
                  {subjectOptions.map(s => <Select.Option key={s} value={s}>{s}</Select.Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述（可选）">
            <Input.TextArea rows={2} placeholder="课堂做题说明" />
          </Form.Item>

          <Form.Item label="题目来源">
            <Radio.Group value={createSource} onChange={(e) => handleSourceChange(e.target.value)} buttonStyle="solid">
              <Radio.Button value="manual">手动输入</Radio.Button>
              <Radio.Button value="bank">从题库选择</Radio.Button>
              <Radio.Button value="ai">AI快速出题</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {createSource === 'manual' && (
            <Form.Item
              name="question_texts"
              label="题目列表"
              rules={[{ required: true, message: '请输入题目' }]}
              extra="每行一道题目，题目将按顺序展示"
            >
              <Input.TextArea
                rows={8}
                placeholder={`1. 计算 25 × 4 = ?\n2. 一个三角形有几个角？\n3. ...`}
              />
            </Form.Item>
          )}

          {createSource === 'bank' && (
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <Space style={{ marginBottom: 8 }} wrap>
                <Select
                  placeholder="按科目筛选"
                  style={{ width: 120 }}
                  allowClear
                  value={bankSubject}
                  onChange={(v) => setBankSubject(v)}
                >
                  {subjectOptions.map(s => <Select.Option key={s} value={s}>{s}</Select.Option>)}
                </Select>
                <Input
                  placeholder="搜索题干关键字"
                  style={{ width: 200 }}
                  value={bankKeyword}
                  onChange={(e) => setBankKeyword(e.target.value)}
                  onPressEnter={() => loadBank(1)}
                />
                <Button icon={<SearchOutlined />} onClick={() => loadBank(1)}>搜索</Button>
              </Space>
              <Table
                dataSource={bankQuestions}
                columns={bankColumns}
                rowKey="id"
                loading={bankLoading}
                size="small"
                pagination={{
                  current: bankPage,
                  pageSize: 10,
                  total: bankTotal,
                  onChange: (p) => loadBank(p),
                  showTotal: (t) => `共 ${t} 题`,
                }}
                rowSelection={{
                  selectedRowKeys: selectedBankIds,
                  onChange: (keys: React.Key[]) => setSelectedBankIds(keys as number[]),
                }}
                locale={{ emptyText: <Empty description="暂无题目，可先在发布作业中用AI生成" /> }}
              />
              <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
                已选 {selectedBankIds.length} 道题（将导入题干与选项文本，作为课堂口答题使用）
              </div>
            </div>
          )}

          {createSource === 'ai' && (
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <Form.Item name="ai_mode" label="出题方式" initialValue="topic" style={{ marginBottom: 12 }}>
                <Radio.Group buttonStyle="solid" size="small">
                  <Radio.Button value="topic">按知识点</Radio.Button>
                  <Radio.Button value="requirements">按详细要求</Radio.Button>
                  <Radio.Button value="paste">粘贴题目</Radio.Button>
                </Radio.Group>
              </Form.Item>

              {aiMode === 'topic' && (
                <Row gutter={8}>
                  <Col span={14}>
                    <Form.Item name="ai_topic" label="知识点主题" rules={[{ required: true, message: '请输入知识点主题' }]} preserve={false}>
                      <Input placeholder="如：分数加减法、古诗背诵" />
                    </Form.Item>
                  </Col>
                  <Col span={5}>
                    <Form.Item name="ai_type" label="题型" initialValue="choice_single" preserve={false}>
                      <Select options={aiTypeOptions} />
                    </Form.Item>
                  </Col>
                  <Col span={5}>
                    <Form.Item name="ai_count" label="数量" initialValue={5} preserve={false}>
                      <InputNumber min={1} max={20} style={{ width: '100%' }} suffix="道" />
                    </Form.Item>
                  </Col>
                </Row>
              )}

              {aiMode === 'requirements' && (
                <>
                  <Form.Item
                    name="ai_requirements"
                    label="详细出题要求"
                    rules={[{ required: true, message: '请填写详细的出题要求' }]}
                    preserve={false}
                  >
                    <Input.TextArea rows={4} maxLength={2000} showCount placeholder={'用一段话描述你想出的课堂题目要求。例如：\n围绕本节课"光的折射"出抢答题，重点考查折射角与入射角的关系，题目要简短适合口头回答。'} />
                  </Form.Item>
                  <Row gutter={8}>
                    <Col span={10}>
                      <Form.Item name="ai_type" label="题型" initialValue="choice_single" preserve={false}>
                        <Select options={aiTypeOptions} />
                      </Form.Item>
                    </Col>
                    <Col span={7}>
                      <Form.Item name="ai_count" label="数量" initialValue={5} preserve={false}>
                        <InputNumber min={1} max={20} style={{ width: '100%' }} suffix="道" />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}

              {aiMode === 'paste' && (
                <Form.Item
                  name="ai_raw_text"
                  label="粘贴题目原文"
                  rules={[{ required: true, message: '请粘贴题目内容' }]}
                  preserve={false}
                  extra="直接粘贴已有的题目（格式不必规范），AI会自动整理并补全参考答案，题目数量以粘贴内容为准"
                >
                  <Input.TextArea rows={8} maxLength={10000} showCount placeholder={'把已有的题目（可从Word/PDF/网页复制）粘贴到这里...'} />
                </Form.Item>
              )}

              {genLimit && (
                <Alert
                  style={{ marginBottom: 12 }}
                  type={genLimit.daily_remaining > 0 ? 'info' : 'warning'}
                  showIcon
                  message={genLimit.daily_remaining > 0
                    ? `今日剩余AI生成次数：${genLimit.daily_remaining} / ${genLimit.daily_limit}（与发布作业共用，次日0点重置）`
                    : `今日AI生成次数已用完（${genLimit.daily_limit}次），请明日0点后再试`}
                />
              )}
              <Button
                type="primary"
                icon={<RobotOutlined />}
                loading={aiLoading}
                onClick={handleGenerateAI}
                disabled={genLimit ? genLimit.daily_remaining <= 0 : false}
                style={{ marginBottom: 12 }}
              >
                {aiLoading ? 'AI正在出题中...' : aiMode === 'paste' ? '🤖 AI整理题目' : '🤖 AI生成题目'}
              </Button>
              {aiQuestions.length > 0 && (
                <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
                  {aiQuestions.map((q, i) => (
                    <div key={i} style={{ padding: '6px 4px', borderBottom: '1px dashed #eee' }}>
                      <Checkbox
                        checked={aiSelected.has(i)}
                        onChange={(e) => {
                          const s = new Set(aiSelected);
                          if (e.target.checked) s.add(i); else s.delete(i);
                          setAiSelected(s);
                        }}
                      />
                      <span style={{ marginLeft: 8 }}>{i + 1}. {q.content}</span>
                      {q.answer && <Tag color="green" style={{ marginLeft: 8 }}>答案: {q.answer}</Tag>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
                参考答案仅供老师核对，不会展示给学生。已勾选 {aiSelected.size} 道。
              </div>
            </div>
          )}
        </Form>
      </Modal>

      {/* 详情 */}
      <Modal
        title={`课堂做题详情: ${quizDetail?.title || ''}`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={900}
      >
        <Spin spinning={detailLoading}>
        {quizDetail && (
          <>
            <Descriptions size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="科目">{quizDetail.subject || '-'}</Descriptions.Item>
              <Descriptions.Item label="班级">{quizDetail.class_name}</Descriptions.Item>
              <Descriptions.Item label="状态">{renderStatus(quizDetail.status)}</Descriptions.Item>
              <Descriptions.Item label="创建者">{quizDetail.creator_name}</Descriptions.Item>
              <Descriptions.Item label="题目数">{questions.length}</Descriptions.Item>
              <Descriptions.Item label="奖励次数">{rewards.length}</Descriptions.Item>
            </Descriptions>
            {quizDetail.description && (
              <Paragraph type="secondary" style={{ marginBottom: 16 }}>{quizDetail.description}</Paragraph>
            )}

            {quizDetail.status === 'active' && questions.length > 0 && (
              <Space style={{ marginBottom: 16 }} wrap>
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => handleOpenConsole(quizDetail)}>
                  进入课堂控制台
                </Button>
                <Button icon={<UserSwitchOutlined />} onClick={startRandomPick}>随机点名</Button>
              </Space>
            )}

            <Tabs
              items={[
                {
                  key: 'questions',
                  label: `题目列表 (${questions.length})`,
                  children: (
                    <List
                      dataSource={questions}
                      renderItem={(q: any, index: number) => (
                        <List.Item
                          actions={
                            quizDetail.status === 'active' ? [
                              <Button
                                key="reward"
                                type="link"
                                size="small"
                                icon={<GiftOutlined />}
                                onClick={() => {
                                  setDetailModalOpen(false);
                                  setTimeout(() => handleOpenReward(quizDetail, q.id), 100);
                                }}
                              >
                                奖励
                              </Button>
                            ] : undefined
                          }
                        >
                          <List.Item.Meta
                            avatar={<Tag color="blue">{index + 1}</Tag>}
                            title={<span style={{ whiteSpace: 'pre-wrap' }}>{q.question_text}</span>}
                          />
                        </List.Item>
                      )}
                      locale={{ emptyText: <Empty description="暂无题目" /> }}
                    />
                  ),
                },
                {
                  key: 'rewards',
                  label: `奖励记录 (${rewards.length})`,
                  children: (
                    <Table
                      dataSource={rewards}
                      columns={rewardColumns}
                      rowKey="id"
                      pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
                      size="small"
                    />
                  ),
                },
                {
                  key: 'answers',
                  label: `答题记录 (${answers.length})`,
                  children: (
                    <Table
                      dataSource={answers}
                      rowKey="id"
                      pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
                      size="small"
                      columns={[
                        { title: '学生', dataIndex: 'student_name', width: 100 },
                        { title: '回答', dataIndex: 'answer_text', ellipsis: true },
                        { title: '判定', width: 70, render: (_: any, r: any) => r.is_correct ? <Tag color="green">正确</Tag> : <Tag color="red">错误</Tag> },
                        { title: '得分', width: 60, dataIndex: 'score', render: (v: number) => `${v ?? 0}分` },
                        { title: '金币', width: 60, dataIndex: 'coin_rewarded', render: (v: number) => v > 0 ? `+${v}` : '-' },
                        { title: '时间', dataIndex: 'created_at', width: 150, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
                      ]}
                      locale={{ emptyText: <Empty description="暂无课堂口答记录（在控制台用AI评判后自动保存）" /> }}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
        </Spin>
      </Modal>

      {/* 随机点名 */}
      <Modal
        title="随机点名"
        open={randomOpen}
        onCancel={() => setRandomOpen(false)}
        footer={
          pickedStudent ? (
            <Space>
              <Button onClick={startRandomPick}>再来一次</Button>
              <Button type="primary" icon={<GiftOutlined />} onClick={handleRewardPicked}>给TA发奖励</Button>
            </Space>
          ) : (
            <Button onClick={() => setRandomOpen(false)}>关闭</Button>
          )
        }
        width={480}
        centered
      >
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: 40, fontWeight: 'bold', color: randomRolling ? '#999' : '#1890ff', minHeight: 60 }}>
            {randomName || '...'}
          </div>
          {pickedStudent && !randomRolling && (
            <div style={{ marginTop: 8 }}>
              {pickedStudent.pet_name && (
                <Text type="secondary">
                  宠物：{pickedStudent.pet_name} Lv.{pickedStudent.pet_level}（{pickedStudent.species_name}）
                </Text>
              )}
            </div>
          )}
          {randomRolling && <div style={{ marginTop: 12, color: '#999' }}>正在随机抽取中...</div>}
        </div>
      </Modal>

      {/* 发放奖励 */}
      <Modal
        title="发放奖励"
        open={rewardModalOpen}
        onCancel={() => { setRewardModalOpen(false); setSelectedStudent(null); setSelectedQuestionId(null); }}
        onOk={() => rewardForm.submit()}
        confirmLoading={rewarding}
        width={700}
      >
        <div style={{ marginBottom: 16 }}>
          <Text strong>选择学生：</Text>
          <div style={{
            marginTop: 8, maxHeight: 200, overflow: 'auto',
            border: '1px solid #f0f0f0', borderRadius: 8, padding: 8
          }}>
            <Row gutter={[8, 8]}>
              {students.map((s: any) => (
                <Col span={12} key={s.id}>
                  <Card
                    size="small"
                    hoverable
                    style={{
                      border: selectedStudent?.id === s.id ? '2px solid #1890ff' : '1px solid #f0f0f0',
                      borderRadius: 8, cursor: 'pointer'
                    }}
                    onClick={() => setSelectedStudent(s)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {s.pet_id ? (
                        <img
                          src={getPetThumbUrl(s)}
                          alt={s.pet_name}
                          style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'contain' }}
                        />
                      ) : (
                        <Avatar icon={<UserOutlined />} size={36} />
                      )}
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: 13 }}>{s.real_name || s.username}</div>
                        {s.pet_name && (
                          <div style={{ fontSize: 11, color: '#888' }}>
                            {s.pet_name} Lv.{s.pet_level} ({s.species_name})
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
              {students.length === 0 && <Empty description="暂无学生" style={{ width: '100%' }} />}
            </Row>
          </div>
        </div>

        {selectedStudent && (
          <div style={{
            padding: 12, background: '#e6f7ff', borderRadius: 8, marginBottom: 16
          }}>
            <Text>已选择: <Text strong>{selectedStudent.real_name || selectedStudent.username}</Text></Text>
            {selectedStudent.pet_name && (
              <Text style={{ marginLeft: 8 }}>宠物: <Text strong>{selectedStudent.pet_name}</Text></Text>
            )}
          </div>
        )}

        <Form form={rewardForm} layout="vertical" onFinish={handleReward}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="reward_type" label="奖励类型" rules={[{ required: true }]}>
                <Select
                  options={Object.entries(REWARD_TYPES).map(([k, v]) => ({ value: k, label: v.label }))}
                  placeholder="选择奖励类型"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              {(rewardType === 'item' || rewardType === 'equipment') ? (
                <Form.Item
                  name="reward_value"
                  label={rewardType === 'item' ? '选择物品' : '选择装备'}
                  rules={[{ required: true, message: rewardType === 'item' ? '请选择物品' : '请选择装备' }]}
                >
                  {rewardType === 'item' ? (
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={items.length === 0}
                      placeholder="选择要发放的物品"
                      options={items.map((it: any) => ({
                        value: it.id,
                        label: `${it.name}（${it.price ?? '-'}金币）`,
                        name: it.name,
                      }))}
                      onSelect={(_, opt: any) => rewardForm.setFieldsValue({ reward_name: opt.name })}
                    />
                  ) : (
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={equipments.length === 0}
                      placeholder="选择要发放的装备"
                      options={equipments.map((eq: any) => ({
                        value: eq.id,
                        label: `${eq.name}（${({ common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' } as Record<string, string>)[eq.rarity] || eq.rarity}）`,
                        name: eq.name,
                      }))}
                      onSelect={(_, opt: any) => rewardForm.setFieldsValue({ reward_name: opt.name })}
                    />
                  )}
                </Form.Item>
              ) : (
                <Form.Item name="reward_value" label="奖励数值" rules={[{ required: true, message: '请输入数量' }]}>
                  <InputNumber min={1} style={{ width: '100%' }} placeholder={rewardType === 'exp' ? '经验值' : '金币数量'} />
                </Form.Item>
              )}
            </Col>
          </Row>
          <Form.Item name="reward_name" label="奖励名称（选物品/装备时自动填写）">
            <Input placeholder="如：100金币、体力药剂" />
          </Form.Item>
          <Form.Item name="reason" label="奖励原因（可选）">
            <Input placeholder="如：回答正确、表现优秀" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 课堂控制台 */}
      {consoleData && (
        <ClassroomConsole
          quiz={consoleData.quiz}
          questions={consoleData.questions}
          onClose={() => { setConsoleData(null); loadQuizzes(); }}
          onRewarded={loadQuizzes}
        />
      )}
    </div>
  );
};

export default ClassroomQuiz;
