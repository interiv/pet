import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Card, Empty, Space, message, Modal, Alert, Badge, Select, Row, Col } from 'antd';
import { assignmentAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';
import { BookOutlined, CheckCircleOutlined, EyeOutlined } from '@ant-design/icons';

const { Option } = Select;

const subjectOptions = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];

const WrongQuestions: React.FC = () => {
  const { user } = useAuthStore();
  const [wrongQuestions, setWrongQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSubject, setFilterSubject] = useState<string>('');
  const [isDetailVisible, setIsDetailVisible] = useState(false);
  const [currentDetail, setCurrentDetail] = useState<any>(null);

  useEffect(() => {
    if (user) loadWrongQuestions();
  }, [user]);

  const loadWrongQuestions = async (subject?: string) => {
    try {
      setLoading(true);
      const params = subject ? { subject } : {};
      const res = await assignmentAPI.getMyWrongQuestions(params);
      setWrongQuestions(res.data.wrong_questions || []);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载错题失败');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkReviewed = async (id: number) => {
    try {
      await assignmentAPI.markWrongQuestionReviewed(id);
      message.success('已标记为已复习');
      loadWrongQuestions(filterSubject);
    } catch (e: any) {
      message.error(e.response?.data?.error || '操作失败');
    }
  };

  const handleViewDetail = (record: any) => {
    setCurrentDetail(record);
    setIsDetailVisible(true);
  };

  const columns = [
    { title: '科目', dataIndex: 'subject', key: 'subject', width: 80, render: (s: string) => <Tag color="blue">{s}</Tag> },
    {
      title: '题目',
      key: 'content',
      render: (_: any, record: any) => (
        <div style={{ maxWidth: 400 }}>
          <div style={{ fontWeight: 500 }}>{record.question_content}</div>
          <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
            来自作业：{record.assignment_title}
          </div>
        </div>
      )
    },
    { title: '题型', dataIndex: 'question_type', key: 'type', width: 100, render: (t: string) => {
      const map: Record<string, { label: string; color: string }> = {
        choice_single: { label: '单选', color: 'green' },
        choice_multi: { label: '多选', color: 'orange' },
        judgment: { label: '判断', color: 'purple' },
        essay: { label: '主观', color: 'red' }
      };
      const info = map[t] || { label: t, color: 'default' };
      return <Tag color={info.color}>{info.label}</Tag>;
    }},
    { title: '你的答案', dataIndex: 'user_answer', width: 100, render: (a: any) => <span style={{ color: '#ff4d4f' }}>{String(a)}</span> },
    { title: '正确答案', dataIndex: 'correct_answer', width: 100, render: (a: any) => <span style={{ color: '#52c41a', fontWeight: 500 }}>{String(a)}</span> },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_: any, record: any) =>
        record.reviewed ? (
          <Badge status="success" text="已复习" />
        ) : (
          <Badge status="error" text="待复习" />
        )
    },
    { title: '错误时间', key: 'created_at', width: 140, render: (_: any, r: any) => dayjs(r.created_at).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)}>详情</Button>
          {!record.reviewed && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => handleMarkReviewed(record.id)}>
              标记已复习
            </Button>
          )}
        </Space>
      )
    }
  ];

  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <h3 style={{ color: '#999' }}>请先登录</h3>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}><BookOutlined /> 错题本</h2>
        <Select
          placeholder="按科目筛选"
          allowClear
          style={{ width: 160 }}
          value={filterSubject || undefined}
          onChange={(v) => { setFilterSubject(v || ''); loadWrongQuestions(v); }}
        >
          {subjectOptions.map(s => <Option key={s} value={s}>{s}</Option>)}
        </Select>
      </div>

      <Alert
        type="info"
        showIcon
        message="做错的题目会自动收录到错题本，建议定期回顾。已复习的题目会自动标记为绿色。"
        style={{ marginBottom: 16 }}
      />

      <Table
        columns={columns}
        dataSource={wrongQuestions}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: <Empty description="暂无错题，继续保持！" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />

      <Modal
        title="错题详情"
        open={isDetailVisible}
        onCancel={() => setIsDetailVisible(false)}
        width={600}
        footer={[
          !currentDetail?.reviewed && (
            <Button key="review" type="primary" icon={<CheckCircleOutlined />} onClick={() => { handleMarkReviewed(currentDetail.id); setIsDetailVisible(false); }}>
              标记为已复习
            </Button>
          ),
          <Button key="close" onClick={() => setIsDetailVisible(false)}>关闭</Button>
        ]}
      >
        {currentDetail && (
          <div>
            <Card size="small" style={{ marginBottom: 16, borderLeft: '4px solid #ff4d4f' }}>
              <div style={{ fontSize: 15, lineHeight: 1.8, marginBottom: 8 }}>
                {currentDetail.question_content}
              </div>
              {currentDetail.options && (
                <div style={{ marginLeft: 8, color: '#666' }}>
                  {(typeof currentDetail.options === 'string' ? JSON.parse(currentDetail.options) : currentDetail.options).map((opt: string, i: number) => (
                    <div key={i}>{String.fromCharCode(65 + i)}. {opt}</div>
                  ))}
                </div>
              )}
            </Card>

            <Card size="small" title="答题分析">
              <Row gutter={[16, 8]}>
                <Col span={12}>
                  <strong style={{ color: '#ff4d4f' }}>你的答案：</strong>{String(currentDetail.user_answer)}
                </Col>
                <Col span={12}>
                  <strong style={{ color: '#52c41a' }}>正确答案：</strong>{String(currentDetail.correct_answer)}
                </Col>
              </Row>
              {currentDetail.explanation && (
                <div style={{ marginTop: 12, padding: 12, background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
                  <strong style={{ color: '#389e0d' }}>解析：</strong><br />
                  <span style={{ color: '#555' }}>{currentDetail.explanation}</span>
                </div>
              )}
              {currentDetail.hint && (
                <div style={{ marginTop: 8, padding: 8, background: '#fffbe6', borderRadius: 6 }}>
                  <strong style={{ color: '#d48806' }}>提示：</strong>{currentDetail.hint}
                </div>
              )}
            </Card>

            <div style={{ marginTop: 12, color: '#999', fontSize: 13 }}>
              来源作业：{currentDetail.assignment_title} | 错误时间：{dayjs(currentDetail.created_at).format('YYYY-MM-DD HH:mm')}
              {currentDetail.wrong_count > 1 && <Tag color="red" style={{ marginLeft: 8 }}>连续错误{currentDetail.wrong_count}次</Tag>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WrongQuestions;
