import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Tag, Card, Space, Select, Input, Button, Modal, Descriptions,
  message, Row, Col, Statistic, Tooltip, Drawer, Empty,
} from 'antd';
import {
  SearchOutlined, FilterOutlined,
  EyeOutlined, BarChartOutlined, ReloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, TeamOutlined,
  FireOutlined, BookOutlined,
} from '@ant-design/icons';
import { questionBankAPI } from '../utils/api';
import dayjs from 'dayjs';

const { Option } = Select;

const typeMap: Record<string, { label: string; color: string }> = {
  choice_single: { label: '单选', color: 'blue' },
  choice_multi: { label: '多选', color: 'geekblue' },
  fill_blank: { label: '填空', color: 'cyan' },
  true_false: { label: '判断', color: 'purple' },
  essay: { label: '主观', color: 'orange' },
};

const difficultyMap: Record<string, { label: string; color: string }> = {
  easy: { label: '简单', color: 'green' },
  medium: { label: '中等', color: 'gold' },
  hard: { label: '困难', color: 'red' },
};

const sourceMap: Record<string, string> = {
  ai: 'AI生成',
  manual: '手动录入',
  import: '批量导入',
};

const QuestionBank: React.FC = () => {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterOptions, setFilterOptions] = useState<{ subjects: string[]; types: string[]; gradeLevels: string[] }>({
    subjects: [], types: [], gradeLevels: [],
  });

  const [filters, setFilters] = useState<Record<string, any>>({});
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [keyword, setKeyword] = useState('');

  const [detailVisible, setDetailVisible] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [statsVisible, setStatsVisible] = useState(false);

  const loadQuestions = useCallback(async () => {
    try {
      setLoading(true);
      const params: any = {
        page,
        pageSize,
        sortBy,
        sortOrder,
        ...filters,
      };
      if (keyword.trim()) {
        params.keyword = keyword.trim();
      }
      const res = await questionBankAPI.getQuestions(params);
      setQuestions(res.data.questions || []);
      setTotal(res.data.total || 0);
      if (res.data.filters) {
        setFilterOptions(res.data.filters);
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载题库失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, filters, keyword]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  const handleFilterChange = (key: string, value: any) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value === undefined || value === '' || value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
    setPage(1);
  };

  const handleSearch = () => {
    setPage(1);
    loadQuestions();
  };

  const handleViewDetail = async (record: any) => {
    try {
      const res = await questionBankAPI.getQuestion(record.id);
      setCurrentQuestion(res.data.question);
      setDetailVisible(true);
    } catch (e: any) {
      message.error('加载题目详情失败');
    }
  };

  const handleViewStats = async (record: any) => {
    try {
      const res = await questionBankAPI.getQuestion(record.id);
      setCurrentQuestion(res.data.question);
      setStatsVisible(true);
    } catch (e: any) {
      message.error('加载统计数据失败');
    }
  };

  const renderAnswer = (record: any) => {
    if (!record.answer) return <span style={{ color: '#999' }}>-</span>;
    if (record.type === 'true_false') {
      return record.answer === 'true' ? '✓ 正确' : '✗ 错误';
    }
    if (record.type === 'choice_single' || record.type === 'choice_multi') {
      return <Tag color="green">{record.answer}</Tag>;
    }
    const text = String(record.answer);
    return text.length > 30 ? text.slice(0, 30) + '...' : text;
  };

  const renderErrorRate = (record: any) => {
    const rate = record.error_rate ?? 0;
    let color = '#52c41a';
    if (rate > 50) color = '#ff4d4f';
    else if (rate > 30) color = '#faad14';
    return (
      <Tooltip title={`答题${record.total_answers || 0}次，错误${record.wrong_answers || 0}次`}>
        <span style={{ color, fontWeight: 'bold' }}>{rate}%</span>
      </Tooltip>
    );
  };

  const columns = [
    {
      title: 'ID', dataIndex: 'id', key: 'id', width: 60,
      sorter: true,
    },
    {
      title: '科目', dataIndex: 'subject', key: 'subject', width: 70,
      render: (s: string) => <Tag color="blue">{s}</Tag>,
    },
    {
      title: '题型', dataIndex: 'type', key: 'type', width: 70,
      render: (t: string) => {
        const info = typeMap[t] || { label: t, color: 'default' };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 70,
      sorter: true,
      render: (d: string) => {
        const info = difficultyMap[d] || { label: d, color: 'default' };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: '题目内容', dataIndex: 'content', key: 'content', ellipsis: true,
      render: (text: string) => (
        <Tooltip title={text} placement="topLeft">
          <span>{text}</span>
        </Tooltip>
      ),
    },
    {
      title: '知识点', dataIndex: 'knowledge_point', key: 'knowledge_point', width: 120, ellipsis: true,
      render: (kp: string) => kp ? <Tag>{kp}</Tag> : <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '答案', dataIndex: 'answer', key: 'answer', width: 80,
      render: (_: any, record: any) => renderAnswer(record),
    },
    {
      title: '错误率', key: 'error_rate', width: 90, sorter: true,
      render: (_: any, record: any) => renderErrorRate(record),
    },
    {
      title: '答题人数', key: 'total_answers', width: 90, sorter: true,
      render: (_: any, record: any) => (
        <Tooltip title={`${record.total_answers || 0} 人答过`}>
          <span><TeamOutlined style={{ marginRight: 4 }} />{record.total_answers || 0}</span>
        </Tooltip>
      ),
    },
    {
      title: '来源', dataIndex: 'source', key: 'source', width: 80,
      render: (s: string) => sourceMap[s] || s,
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 110, sorter: true,
      render: (t: string) => t ? dayjs(t).format('MM-DD HH:mm') : '-',
    },
    {
      title: '操作', key: 'actions', width: 120, fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)}>
            详情
          </Button>
          <Button type="link" size="small" icon={<BarChartOutlined />} onClick={() => handleViewStats(record)}>
            统计
          </Button>
        </Space>
      ),
    },
  ];

  const handleTableChange = (pagination: any, _filters: any, sorter: any) => {
    if (pagination.current !== page) setPage(pagination.current);
    if (pagination.pageSize !== pageSize) {
      setPageSize(pagination.pageSize);
      setPage(1);
    }
    if (sorter.field) {
      setSortBy(sorter.field === 'error_rate' ? 'error_rate' : sorter.field === 'total_answers' ? 'total_answers' : sorter.field);
      setSortOrder(sorter.order === 'ascend' ? 'asc' : 'desc');
    }
  };

  const activeFilterCount = Object.keys(filters).length + (keyword.trim() ? 1 : 0);

  return (
    <Card
      title={
        <Space>
          <BookOutlined />
          <span>题库</span>
          <Tag color="processing">{total} 道题目</Tag>
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined />} onClick={loadQuestions} loading={loading}>
          刷新
        </Button>
      }
    >
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Input
            placeholder="搜索题目内容..."
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onPressEnter={handleSearch}
            allowClear
            suffix={
              <Button type="link" size="small" icon={<SearchOutlined />} onClick={handleSearch} style={{ padding: 0 }} />
            }
          />
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Select
            placeholder="科目"
            allowClear
            style={{ width: '100%' }}
            value={filters.subject}
            onChange={v => handleFilterChange('subject', v)}
          >
            {filterOptions.subjects.map(s => <Option key={s} value={s}>{s}</Option>)}
          </Select>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Select
            placeholder="题型"
            allowClear
            style={{ width: '100%' }}
            value={filters.type}
            onChange={v => handleFilterChange('type', v)}
          >
            {filterOptions.types.map(t => (
              <Option key={t} value={t}>{(typeMap[t] || { label: t }).label}</Option>
            ))}
          </Select>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Select
            placeholder="难度"
            allowClear
            style={{ width: '100%' }}
            value={filters.difficulty}
            onChange={v => handleFilterChange('difficulty', v)}
          >
            <Option value="easy">简单</Option>
            <Option value="medium">中等</Option>
            <Option value="hard">困难</Option>
          </Select>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Select
            placeholder="来源"
            allowClear
            style={{ width: '100%' }}
            value={filters.source}
            onChange={v => handleFilterChange('source', v)}
          >
            <Option value="ai">AI生成</Option>
            <Option value="manual">手动录入</Option>
          </Select>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Select
            placeholder="学段"
            allowClear
            style={{ width: '100%' }}
            value={filters.grade_level}
            onChange={v => handleFilterChange('grade_level', v)}
          >
            {filterOptions.gradeLevels.map(g => <Option key={g} value={g}>{g}</Option>)}
          </Select>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Select
            placeholder="排序"
            style={{ width: '100%' }}
            value={`${sortBy}_${sortOrder}`}
            onChange={v => {
              const [field, order] = v.split('_');
              setSortBy(field);
              setSortOrder(order);
              setPage(1);
            }}
          >
            <Option value="created_at_desc">最新优先</Option>
            <Option value="created_at_asc">最早优先</Option>
            <Option value="error_rate_desc">错误率↓</Option>
            <Option value="error_rate_asc">错误率↑</Option>
            <Option value="total_answers_desc">答题人数↓</Option>
            <Option value="total_answers_asc">答题人数↑</Option>
            <Option value="difficulty_asc">难度↑</Option>
            <Option value="difficulty_desc">难度↓</Option>
          </Select>
        </Col>
      </Row>

      {activeFilterCount > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Space>
            <FilterOutlined />
            <span style={{ color: '#888' }}>已应用 {activeFilterCount} 个筛选条件</span>
            <Button
              size="small"
              onClick={() => {
                setFilters({});
                setKeyword('');
                setSortBy('created_at');
                setSortOrder('desc');
                setPage(1);
              }}
            >
              清除全部
            </Button>
          </Space>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={questions}
        rowKey="id"
        loading={loading}
        onChange={handleTableChange}
        scroll={{ x: 1300 }}
        size="middle"
        locale={{ emptyText: <Empty description="暂无题目数据，请老师先生成作业题目" /> }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showQuickJumper: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (t) => `共 ${t} 道题目`,
        }}
      />

      <Modal
        title="题目详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={700}
      >
        {currentQuestion && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="ID">{currentQuestion.id}</Descriptions.Item>
            <Descriptions.Item label="科目">
              <Tag color="blue">{currentQuestion.subject}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="题型">
              <Tag color={(typeMap[currentQuestion.type] || {}).color}>
                {(typeMap[currentQuestion.type] || { label: currentQuestion.type }).label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="难度">
              <Tag color={(difficultyMap[currentQuestion.difficulty] || {}).color}>
                {(difficultyMap[currentQuestion.difficulty] || { label: currentQuestion.difficulty }).label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="知识点" span={2}>
              {currentQuestion.knowledge_point || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="题目内容" span={2}>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{currentQuestion.content}</div>
            </Descriptions.Item>
            {currentQuestion.options && Array.isArray(currentQuestion.options) && currentQuestion.options.length > 0 && (
              <Descriptions.Item label="选项" span={2}>
                {currentQuestion.options.map((opt: string, i: number) => (
                  <div key={i}>{String.fromCharCode(65 + i)}. {opt}</div>
                ))}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="正确答案" span={2}>
              <Tag color="green" style={{ fontSize: 14 }}>{currentQuestion.answer}</Tag>
            </Descriptions.Item>
            {currentQuestion.explanation && (
              <Descriptions.Item label="解析" span={2}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{currentQuestion.explanation}</div>
              </Descriptions.Item>
            )}
            {currentQuestion.analysis && (
              <Descriptions.Item label="分析" span={2}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{currentQuestion.analysis}</div>
              </Descriptions.Item>
            )}
            {currentQuestion.hint && (
              <Descriptions.Item label="提示" span={2}>
                {currentQuestion.hint}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="来源">{sourceMap[currentQuestion.source] || currentQuestion.source}</Descriptions.Item>
            <Descriptions.Item label="创建者">{currentQuestion.creator_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {currentQuestion.created_at ? dayjs(currentQuestion.created_at).format('YYYY-MM-DD HH:mm') : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {currentQuestion.updated_at ? dayjs(currentQuestion.updated_at).format('YYYY-MM-DD HH:mm') : '-'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Drawer
        title="题目统计"
        open={statsVisible}
        onClose={() => setStatsVisible(false)}
        width={400}
      >
        {currentQuestion && (
          <>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Card size="small">
                  <Statistic
                    title="答题总人数"
                    value={currentQuestion.total_answers || 0}
                    prefix={<TeamOutlined />}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small">
                  <Statistic
                    title="错误人数"
                    value={currentQuestion.wrong_answers || 0}
                    prefix={<CloseCircleOutlined />}
                    valueStyle={{ color: '#ff4d4f' }}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small">
                  <Statistic
                    title="正确人数"
                    value={(currentQuestion.total_answers || 0) - (currentQuestion.wrong_answers || 0)}
                    prefix={<CheckCircleOutlined />}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small">
                  <Statistic
                    title="错误率"
                    value={currentQuestion.error_rate ?? 0}
                    suffix="%"
                    prefix={<FireOutlined />}
                    valueStyle={{
                      color: (currentQuestion.error_rate ?? 0) > 50 ? '#ff4d4f' :
                        (currentQuestion.error_rate ?? 0) > 30 ? '#faad14' : '#52c41a',
                    }}
                  />
                </Card>
              </Col>
            </Row>
            <Descriptions column={1} bordered size="small" style={{ marginTop: 16 }}>
              <Descriptions.Item label="题目ID">{currentQuestion.id}</Descriptions.Item>
              <Descriptions.Item label="科目">{currentQuestion.subject}</Descriptions.Item>
              <Descriptions.Item label="知识点">{currentQuestion.knowledge_point || '-'}</Descriptions.Item>
              <Descriptions.Item label="使用次数">{currentQuestion.usage_count || 0}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>
    </Card>
  );
};

export default QuestionBank;
