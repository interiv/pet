import React, { useEffect, useState } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Select, InputNumber,
  message, Space, Tag, Tabs, Descriptions, Row, Col, Typography,
  List, Avatar, Popconfirm, Empty, Badge, Spin
} from 'antd';
import {
  PlusOutlined, GiftOutlined, CheckCircleOutlined,
  UserOutlined, EyeOutlined, PlayCircleOutlined
} from '@ant-design/icons';
import { classroomQuizAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { getPetThumbUrl } from '../utils/petImage';

const { Title, Text, Paragraph } = Typography;

const REWARD_TYPES: Record<string, { label: string; color: string }> = {
  gold: { label: '金币', color: 'gold' },
  item: { label: '物品', color: 'green' },
  equipment: { label: '装备', color: 'blue' },
  exp: { label: '经验', color: 'orange' },
};

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
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rewarding, setRewarding] = useState(false);
  const [createForm] = Form.useForm();
  const [rewardForm] = Form.useForm();

  useEffect(() => {
    loadQuizzes();
  }, []);

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

  const handleCreate = async (values: any) => {
    try {
      const questions = values.question_texts
        .split('\n')
        .filter((line: string) => line.trim())
        .map((text: string) => ({ question_text: text.trim() }));

      if (questions.length === 0) {
        message.warning('请至少输入一道题目');
        return;
      }

      await classroomQuizAPI.createQuiz({
        title: values.title,
        description: values.description,
        subject: values.subject,
        class_id: currentClass?.id || values.class_id,
        questions,
      });

      message.success('课堂做题创建成功');
      setCreateModalOpen(false);
      createForm.resetFields();
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

  const handleOpenReward = async (quiz: any, questionId: number | null = null) => {
    setSelectedQuiz(quiz);
    setSelectedQuestionId(questionId);
    setRewardModalOpen(true);
    rewardForm.resetFields();

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

      message.success(`已向 ${selectedStudent.username} 发放奖励`);
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
      render: (s: string) => {
        const map: Record<string, { color: string; label: string }> = {
          active: { color: 'processing', label: '进行中' },
          completed: { color: 'success', label: '已完成' },
          cancelled: { color: 'default', label: '已取消' },
        };
        return <Badge status={map[s]?.color as any} text={map[s]?.label || s} />;
      }
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

      <Modal
        title="创建课堂做题"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        width={700}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
                <Input placeholder="如：第三单元随堂练习" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="subject" label="科目">
                <Input placeholder="如：数学" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述（可选）">
            <Input.TextArea rows={2} placeholder="课堂做题说明" />
          </Form.Item>
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
        </Form>
      </Modal>

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
              <Descriptions.Item label="状态">
                <Badge status={quizDetail.status === 'active' ? 'processing' : 'success'} text={quizDetail.status === 'active' ? '进行中' : '已完成'} />
              </Descriptions.Item>
              <Descriptions.Item label="创建者">{quizDetail.creator_name}</Descriptions.Item>
              <Descriptions.Item label="题目数">{questions.length}</Descriptions.Item>
              <Descriptions.Item label="奖励次数">{rewards.length}</Descriptions.Item>
            </Descriptions>
            {quizDetail.description && (
              <Paragraph type="secondary" style={{ marginBottom: 16 }}>{quizDetail.description}</Paragraph>
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
                            title={q.question_text}
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
              ]}
            />
          </>
        )}
        </Spin>
      </Modal>

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
                        <div style={{ fontWeight: 'bold', fontSize: 13 }}>{s.username}</div>
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
            <Text>已选择: <Text strong>{selectedStudent.username}</Text></Text>
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
              <Form.Item name="reward_value" label="奖励数值" rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="数量/金币/经验" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="reward_name" label="奖励名称（可选）">
            <Input placeholder="如：100金币、体力药剂" />
          </Form.Item>
          <Form.Item name="reason" label="奖励原因（可选）">
            <Input placeholder="如：回答正确、表现优秀" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ClassroomQuiz;
