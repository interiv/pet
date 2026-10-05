import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Input, message, Tag, Space, Row, Col, Statistic, Divider, Progress } from 'antd';
import { LineChartOutlined, FireOutlined } from '@ant-design/icons';
import { adminAPI } from '../../utils/api';
import { questionTypeLabel } from '../../utils/questionTypes';

const TokenDashboard: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsPagination, setRecordsPagination] = useState({ page: 1, pageSize: 10, total: 0 });
  const [filterDate, setFilterDate] = useState<string>('');
  const [filterUserId, setFilterUserId] = useState<number | undefined>();

  useEffect(() => {
    loadDashboard();
    loadRecords();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getTokenUsageDashboard();
      setDashboardData(res.data);
    } catch (error) {
      message.error('加载Token看板失败');
    } finally {
      setLoading(false);
    }
  };

  const loadRecords = async (page = 1, userId?: number, date?: string) => {
    setRecordsLoading(true);
    try {
      const params: any = { page, pageSize: recordsPagination.pageSize };
      if (userId) params.user_id = userId;
      if (date) params.date = date;
      const res = await adminAPI.getTokenUsageRecords(params);
      setRecords(res.data.records || []);
      setRecordsPagination(prev => ({ ...prev, page, total: res.data.total }));
    } catch (error) {
      message.error('加载记录失败');
    } finally {
      setRecordsLoading(false);
    }
  };

  const formatTokens = (n: number) => {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  };

  const today = dashboardData?.today || {};
  const settings = dashboardData?.settings || {};
  const globalLimit = settings.daily_global_token_limit || 2000000;
  const globalUsed = today.total_completion_tokens || 0;
  const globalPercent = globalLimit > 0 ? Math.min(100, (globalUsed / globalLimit) * 100) : 0;

  const recordColumns = [
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 160, render: (v: string) => v?.replace('T', ' ').slice(0, 19) || '-' },
    { title: '教师', dataIndex: 'real_name', key: 'username', width: 100, render: (v: string, r: any) => v || r.username },
    { title: '科目', dataIndex: 'subject', key: 'subject', width: 80 },
    { title: '主题', dataIndex: 'topic', key: 'topic', width: 120, ellipsis: true },
    { title: '题型', dataIndex: 'question_type', key: 'question_type', width: 80, render: (v: string) => questionTypeLabel(v) },
    { title: '题目数', dataIndex: 'question_count', key: 'question_count', width: 70 },
    { title: 'Prompt', dataIndex: 'prompt_tokens', key: 'prompt_tokens', width: 80, render: (v: number) => formatTokens(v) },
    { title: 'Completion', dataIndex: 'completion_tokens', key: 'completion_tokens', width: 90, render: (v: number) => formatTokens(v) },
    { title: '总计', dataIndex: 'total_tokens', key: 'total_tokens', width: 80, render: (v: number) => <Tag color="blue">{formatTokens(v)}</Tag> },
    { title: '耗时', dataIndex: 'duration_ms', key: 'duration_ms', width: 80, render: (v: number) => v ? (v / 1000).toFixed(1) + 's' : '-' },
  ];

  return (
    <div>
      <Card title={<span><LineChartOutlined /> 今日Token消耗概览</span>} style={{ marginBottom: 16 }} loading={loading}>
        <Row gutter={16}>
          <Col xs={12} sm={6}>
            <Statistic title="今日生成次数" value={today.total_generations || 0} suffix="次" />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic title="Prompt Tokens" value={today.total_prompt_tokens || 0} formatter={(v) => formatTokens(v as number)} />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic title="Completion Tokens" value={today.total_completion_tokens || 0} formatter={(v) => formatTokens(v as number)} />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic title="总Tokens" value={today.total_tokens || 0} formatter={(v) => formatTokens(v as number)} />
          </Col>
        </Row>
        <Divider style={{ margin: '16px 0' }} />
        <div style={{ marginBottom: 8 }}>
          <span>全站Token消耗进度（Completion Tokens）</span>
          <span style={{ float: 'right', color: globalPercent > 80 ? '#ff4d4f' : '#52c41a' }}>
            {formatTokens(globalUsed)} / {formatTokens(globalLimit)} ({globalPercent.toFixed(1)}%)
          </span>
        </div>
        <Progress percent={globalPercent} strokeColor={globalPercent > 80 ? '#ff4d4f' : globalPercent > 50 ? '#faad14' : '#52c41a'} showInfo={false} />
      </Card>

      {dashboardData?.topTeachers?.length > 0 && (
        <Card title={<span><FireOutlined /> 今日教师Token消耗排行</span>} style={{ marginBottom: 16 }} loading={loading}>
          <Table
            size="small"
            pagination={false}
            dataSource={dashboardData.topTeachers}
            rowKey="user_id"
            columns={[
              { title: '教师', dataIndex: 'real_name', key: 'username', render: (v: string, r: any) => v || r.username },
              { title: '生成次数', dataIndex: 'generations', key: 'generations', width: 80 },
              { title: 'Prompt', dataIndex: 'prompt_tokens', key: 'prompt_tokens', width: 100, render: (v: number) => formatTokens(v) },
              { title: 'Completion', dataIndex: 'completion_tokens', key: 'completion_tokens', width: 100, render: (v: number) => formatTokens(v) },
              { title: '总Tokens', dataIndex: 'total_tokens', key: 'total_tokens', width: 100, render: (v: number) => <Tag color="blue">{formatTokens(v)}</Tag> },
            ]}
          />
        </Card>
      )}

      {dashboardData?.last7Days?.length > 0 && (
        <Card title="近7天Token消耗趋势" style={{ marginBottom: 16 }} loading={loading}>
          <Table
            size="small"
            pagination={false}
            dataSource={dashboardData.last7Days}
            rowKey="date"
            columns={[
              { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
              { title: '生成次数', dataIndex: 'generations', key: 'generations', width: 90 },
              { title: '活跃教师', dataIndex: 'active_teachers', key: 'active_teachers', width: 90 },
              { title: 'Prompt', dataIndex: 'prompt_tokens', key: 'prompt_tokens', width: 100, render: (v: number) => formatTokens(v) },
              { title: 'Completion', dataIndex: 'completion_tokens', key: 'completion_tokens', width: 100, render: (v: number) => formatTokens(v) },
              { title: '总Tokens', dataIndex: 'total_tokens', key: 'total_tokens', width: 100, render: (v: number) => <Tag color="blue">{formatTokens(v)}</Tag> },
            ]}
          />
        </Card>
      )}

      <Card title="Token使用明细" extra={
        <Space>
          <Input placeholder="教师ID" type="number" style={{ width: 100 }} value={filterUserId || ''} onChange={e => setFilterUserId(e.target.value ? parseInt(e.target.value) : undefined)} />
          <Input placeholder="日期(YYYY-MM-DD)" style={{ width: 140 }} value={filterDate} onChange={e => setFilterDate(e.target.value)} />
          <Button onClick={() => loadRecords(1, filterUserId, filterDate)}>筛选</Button>
          <Button onClick={() => { setFilterDate(''); setFilterUserId(undefined); loadRecords(1); }}>重置</Button>
        </Space>
      }>
        <Table
          size="small"
          loading={recordsLoading}
          dataSource={records}
          rowKey="id"
          columns={recordColumns}
          pagination={{
            current: recordsPagination.page,
            pageSize: recordsPagination.pageSize,
            total: recordsPagination.total,
            onChange: (p) => loadRecords(p, filterUserId, filterDate),
            showTotal: (total) => `共 ${total} 条`,
          }}
          scroll={{ x: 1000 }}
        />
      </Card>
    </div>
  );
};

export { TokenDashboard };
export default TokenDashboard;
