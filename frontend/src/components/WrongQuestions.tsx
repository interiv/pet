import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Card, Empty, Space, message, Modal, Alert, Badge, Select, Row, Col, Statistic, Progress } from 'antd';
import { assignmentAPI, knowledgePointAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';
import { BookOutlined, CheckCircleOutlined, EyeOutlined, AimOutlined, ThunderboltOutlined } from '@ant-design/icons';

const { Option } = Select;

const subjectOptions = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

const WrongQuestions: React.FC = () => {
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [wrongQuestions, setWrongQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSubject, setFilterSubject] = useState<string>('');
  const [isDetailVisible, setIsDetailVisible] = useState(false);
  const [currentDetail, setCurrentDetail] = useState<any>(null);
  const [isSimilarVisible, setIsSimilarVisible] = useState(false);
  const [similarQuestions, setSimilarQuestions] = useState<any[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarMeta, setSimilarMeta] = useState<{ knowledge_point?: string | null }>({});
  const [wqTablePage, setWqTablePage] = useState(1);
  const [wqTablePageSize, setWqTablePageSize] = useState(10);

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

  const handleLoadSimilar = async () => {
    if (!currentDetail?.question_id) {
      message.warning('无法定位题目ID');
      return;
    }
    try {
      setSimilarLoading(true);
      const res = await knowledgePointAPI.getSimilarQuestions({ question_id: currentDetail.question_id, limit: 5 });
      setSimilarQuestions(res.data.similar_questions || []);
      setSimilarMeta({ knowledge_point: res.data.knowledge_point });
      setIsSimilarVisible(true);
      if ((res.data.similar_questions || []).length === 0) {
        message.info('暂未找到可练习的相似题，试着让老师布置更多这个知识点的题目吧');
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载相似题失败');
    } finally {
      setSimilarLoading(false);
    }
  };

  const typeMap: Record<string, { label: string; color: string }> = {
    choice_single: { label: '单选', color: 'green' },
    choice_multi: { label: '多选', color: 'orange' },
    judgment: { label: '判断', color: 'purple' },
    essay: { label: '主观', color: 'red' }
  };

  const columns = [
    { title: '科目', dataIndex: 'subject', key: 'subject', width: 80, responsive: ['md'] as any, render: (s: string) => <Tag color="blue">{s}</Tag> },
    {
      title: '题目',
      key: 'content',
      render: (_: any, record: any) => (
        <div style={{ maxWidth: isMobile ? '100%' : 400 }}>
          <div style={{ fontWeight: 500 }}>{record.question_content}</div>
          <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
            来自作业：{record.assignment_title}
          </div>
          {isMobile && (
            <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <Tag color="blue">{record.subject}</Tag>
              <Tag color={typeMap[record.question_type]?.color || 'default'}>{typeMap[record.question_type]?.label || record.question_type}</Tag>
              <span style={{ color: '#ff4d4f', fontSize: 12 }}>你的：{String(record.wrong_answer)}</span>
              <span style={{ color: '#52c41a', fontSize: 12 }}>正确：{String(record.correct_answer)}</span>
            </div>
          )}
        </div>
      )
    },
    { title: '题型', dataIndex: 'question_type', key: 'type', width: 100, responsive: ['md'] as any, render: (t: string) => {
      const info = typeMap[t] || { label: t, color: 'default' };
      return <Tag color={info.color}>{info.label}</Tag>;
    }},
    { title: '你的答案', dataIndex: 'wrong_answer', width: 100, responsive: ['md'] as any, render: (a: any) => <span style={{ color: '#ff4d4f' }}>{String(a)}</span> },
    { title: '正确答案', dataIndex: 'correct_answer', width: 100, responsive: ['md'] as any, render: (a: any) => <span style={{ color: '#52c41a', fontWeight: 500 }}>{String(a)}</span> },
    {
      title: '状态',
      key: 'status',
      width: 90,
      responsive: ['sm'] as any,
      render: (_: any, record: any) =>
        record.reviewed ? (
          <Badge status="success" text="已复习" />
        ) : (
          <Badge status="error" text="待复习" />
        )
    },
    { title: '错误时间', key: 'created_at', width: 140, responsive: ['lg'] as any, render: (_: any, r: any) => dayjs(r.created_at).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: any) => (
        <Space size="small" wrap>
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

  const renderMobileCard = (record: any) => (
    <Card key={record.id} size="small" style={{ marginBottom: 12, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
            {record.question_content}
          </div>
          <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>来自作业：{record.assignment_title}</div>
        </div>
        {record.reviewed ? (
          <Badge status="success" text="已复习" style={{ marginLeft: 8, whiteSpace: 'nowrap' }} />
        ) : (
          <Badge status="error" text="待复习" style={{ marginLeft: 8, whiteSpace: 'nowrap' }} />
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        <Tag color="blue">{record.subject}</Tag>
        <Tag color={typeMap[record.question_type]?.color || 'default'}>{typeMap[record.question_type]?.label || record.question_type}</Tag>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 8 }}>
        <span>你的答案：<span style={{ color: '#ff4d4f', fontWeight: 500 }}>{String(record.wrong_answer)}</span></span>
        <span>正确答案：<span style={{ color: '#52c41a', fontWeight: 500 }}>{String(record.correct_answer)}</span></span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#999', fontSize: 12 }}>{dayjs(record.created_at).format('MM-DD HH:mm')}</span>
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)}>详情</Button>
          {!record.reviewed && (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => handleMarkReviewed(record.id)}>标记已复习</Button>
          )}
        </Space>
      </div>
    </Card>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}><BookOutlined /> 错题本</h2>
        <Select
          placeholder="按科目筛选"
          allowClear
          style={{ width: isMobile ? '100%' : 160 }}
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

      {wrongQuestions.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={8} md={6}>
            <Card size="small"><Statistic title="错题总数" value={wrongQuestions.length} prefix={<BookOutlined />} /></Card>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Card size="small">
              <Statistic
                title="待复习"
                value={wrongQuestions.filter((w: any) => !w.reviewed).length}
                prefix={<AimOutlined />}
                valueStyle={{ color: '#ff4d4f' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Card size="small">
              <Statistic
                title="已复习"
                value={wrongQuestions.filter((w: any) => w.reviewed).length}
                prefix={<CheckCircleOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Card size="small">
              <div style={{ marginBottom: 4 }}>复习进度</div>
              <Progress
                percent={wrongQuestions.length > 0 ? Math.round(wrongQuestions.filter((w: any) => w.reviewed).length / wrongQuestions.length * 100) : 0}
                size="small"
                status={wrongQuestions.filter((w: any) => w.reviewed).length === wrongQuestions.length ? 'success' : 'active'}
              />
            </Card>
          </Col>
        </Row>
      )}

      {isMobile ? (
        <div>
          {loading && <Card loading />}
          {!loading && wrongQuestions.length === 0 && <Empty description="暂无错题，继续保持！" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          {wrongQuestions.map((record: any) => renderMobileCard(record))}
          {wrongQuestions.length > 0 && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Space>
                <Button disabled={wqTablePage <= 1} onClick={() => setWqTablePage(p => p - 1)}>上一页</Button>
                <span style={{ color: '#999' }}>{wqTablePage} / {Math.max(1, Math.ceil(wrongQuestions.length / wqTablePageSize))}</span>
                <Button disabled={wqTablePage >= Math.ceil(wrongQuestions.length / wqTablePageSize)} onClick={() => setWqTablePage(p => p + 1)}>下一页</Button>
              </Space>
            </div>
          )}
        </div>
      ) : (
        <Table
          columns={columns}
          dataSource={wrongQuestions}
          rowKey="id"
          loading={loading}
          pagination={{
            current: wqTablePage,
            pageSize: wqTablePageSize,
            onChange: (page, size) => { setWqTablePage(page); setWqTablePageSize(size); },
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (total) => `共 ${total} 条`
          }}
          scroll={{ x: true }}
          locale={{ emptyText: <Empty description="暂无错题，继续保持！" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      )}

      <Modal
        title="错题详情"
        open={isDetailVisible}
        onCancel={() => setIsDetailVisible(false)}
        width={isMobile ? '95vw' : 600}
        footer={[
          <Button key="similar" icon={<ThunderboltOutlined />} loading={similarLoading} onClick={handleLoadSimilar}>
            练习相似题
          </Button>,
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
                <Col xs={24} sm={12}>
                  <strong style={{ color: '#ff4d4f' }}>你的答案：</strong>{String(currentDetail.wrong_answer)}
                </Col>
                <Col xs={24} sm={12}>
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
              {currentDetail.knowledge_point && <Tag color="blue" style={{ marginLeft: 8 }}>🏷️ {currentDetail.knowledge_point}</Tag>}
              {currentDetail.wrong_count > 1 && <Tag color="red" style={{ marginLeft: 8 }}>连续错误{currentDetail.wrong_count}次</Tag>}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={<span><ThunderboltOutlined /> 相似题练习{similarMeta.knowledge_point ? ` · ${similarMeta.knowledge_point}` : ''}</span>}
        open={isSimilarVisible}
        onCancel={() => setIsSimilarVisible(false)}
        width={isMobile ? '95vw' : 700}
        footer={<Button onClick={() => setIsSimilarVisible(false)}>关闭</Button>}
      >
        {similarQuestions.length === 0 ? (
          <Empty description="暂无可推荐的相似题" />
        ) : (
          <div>
            <Alert
              type="info"
              showIcon
              message={`为你找到 ${similarQuestions.length} 道相似题，试着做做看能不能巩固知识点。可先思考答案，再点开查看解析。`}
              style={{ marginBottom: 12 }}
            />
            {similarQuestions.map((q, idx) => (
              <Card
                key={q.id}
                size="small"
                style={{ marginBottom: 12, borderLeft: '4px solid #1677ff' }}
                title={<span>题{idx + 1} <Tag color="blue">{q.subject}</Tag>{q.difficulty && <Tag>{q.difficulty}</Tag>}{q.knowledge_point && <Tag color="cyan">{q.knowledge_point}</Tag>}</span>}
              >
                <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 8 }}>{q.content}</div>
                {q.options && Array.isArray(q.options) && (
                  <div style={{ marginLeft: 8, color: '#555', marginBottom: 8 }}>
                    {q.options.map((opt: string, i: number) => (
                      <div key={i}>{String.fromCharCode(65 + i)}. {opt}</div>
                    ))}
                  </div>
                )}
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', color: '#1677ff' }}>👁️ 查看答案与解析</summary>
                  <div style={{ marginTop: 8, padding: 8, background: '#f6ffed', borderRadius: 4 }}>
                    <div><strong style={{ color: '#52c41a' }}>答案：</strong>{String(q.answer)}</div>
                    {q.explanation && <div style={{ marginTop: 4 }}><strong>解析：</strong>{q.explanation}</div>}
                    {q.hint && <div style={{ marginTop: 4, color: '#d48806' }}><strong>提示：</strong>{q.hint}</div>}
                  </div>
                </details>
              </Card>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WrongQuestions;
