import React, { useEffect, useState } from 'react';
import { Card, Table, message, Tag, Space, Row, Col, Statistic, List, Badge } from 'antd';
import { UserOutlined, TeamOutlined, FolderOutlined } from '@ant-design/icons';
import { adminAPI } from '../../utils/api';
import { useAuthStore } from '../../store/authStore';
import { useMobile } from './hooks';

const Dashboard: React.FC = () => {
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [statistics, setStatistics] = useState<any>(null);
  const [operationalStats, setOperationalStats] = useState<any>(null);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, opsRes] = await Promise.all([
        adminAPI.getStatistics(),
        isAdmin ? adminAPI.getOperationalStats().catch(() => ({ data: {} })) : Promise.resolve({ data: {} })
      ]);
      setStatistics(statsRes.data.statistics);
      setOperationalStats(opsRes.data);
    } catch (error) {
      message.error('加载统计数据失败');
    }
  };

  if (!statistics) return null;

  // 教师工作台
  if (!isAdmin) {
    return (
      <div>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={12}>
            <Card><Statistic title="我的班级" value={statistics.classes.total || 0} prefix={<FolderOutlined />} /></Card>
          </Col>
          <Col span={12}>
            <Card><Statistic title="班级学生数" value={statistics.users.students || 0} prefix={<TeamOutlined />} /></Card>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={24}>
            <Card title="班级概况">
              <p>欢迎来到教师工作台！您可以管理您的班级和入学申请。</p>
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  // 简易趋势条形图
  const MiniBarChart = ({ data, color = '#1890ff', height = 60 }: { data: { date: string; count: number }[]; color?: string; height?: number }) => {
    if (!data || data.length === 0) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>暂无数据</div>;
    const max = Math.max(...data.map(d => d.count), 1);
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height, padding: '4px 0' }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#999' }}>{d.count}</span>
            <div style={{ width: '100%', background: color, borderRadius: 3, height: `${(d.count / max) * (height - 20)}px`, minHeight: d.count > 0 ? 4 : 0, transition: 'height 0.3s' }} />
            <span style={{ fontSize: 9, color: '#bbb' }}>{d.date.slice(5)}</span>
          </div>
        ))}
      </div>
    );
  };

  const ops = operationalStats || {};
  const pendingTeachers = ops.pending?.teachers ?? statistics.status?.pending_teachers ?? 0;
  const pendingApps = ops.pending?.applications ?? 0;
  const dauTrend = ops.trends?.dau || [];
  const submissionTrend = ops.trends?.submissions || [];
  const assignmentTrend = ops.trends?.assignments || [];
  const teacherActivity = ops.teacher_activity || [];
  const recentEvents = ops.recent_events || [];

  const eventIconMap: Record<string, string> = {
    register: '👤',
    assignment: '📝',
    announcement: '📢',
  };

  return (
    <div>
      {/* 待处理事项 */}
      <Row gutter={[16, 16]} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={24} sm={12}>
          <Card
            hoverable
            style={{ borderLeft: pendingTeachers > 0 ? '4px solid #faad14' : '4px solid #d9d9d9' }}
            styles={{ body: { padding: isMobile ? '12px 16px' : '16px 20px' } }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>待审批教师</div>
                <div style={{ fontSize: 28, fontWeight: 'bold', color: pendingTeachers > 0 ? '#faad14' : '#52c41a' }}>{pendingTeachers}</div>
              </div>
              <div style={{ fontSize: 36, opacity: 0.3 }}>👩‍🏫</div>
            </div>
            {pendingTeachers > 0 && <div style={{ marginTop: 8, fontSize: 12, color: '#faad14' }}>有待审批的教师注册申请</div>}
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card
            hoverable
            style={{ borderLeft: pendingApps > 0 ? '4px solid #1890ff' : '4px solid #d9d9d9' }}
            styles={{ body: { padding: isMobile ? '12px 16px' : '16px 20px' } }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>待处理入学申请</div>
                <div style={{ fontSize: 28, fontWeight: 'bold', color: pendingApps > 0 ? '#1890ff' : '#52c41a' }}>{pendingApps}</div>
              </div>
              <div style={{ fontSize: 36, opacity: 0.3 }}>📋</div>
            </div>
            {pendingApps > 0 && <div style={{ marginTop: 8, fontSize: 12, color: '#1890ff' }}>有待处理的班级入学申请</div>}
          </Card>
        </Col>
      </Row>

      {/* 核心指标 */}
      <Row gutter={[16, 16]} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={12} sm={6}>
          <Card><Statistic title="总用户" value={statistics.users.total} prefix={<UserOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title="今日活跃" value={statistics.daily?.active_users || 0} prefix={<UserOutlined />} valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title="班级数" value={statistics.classes.total} prefix={<FolderOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title="教师/学生" value={`${statistics.users.teachers}/${statistics.users.students}`} valueStyle={{ fontSize: 20 }} /></Card>
        </Col>
      </Row>

      {/* 趋势图 */}
      <Row gutter={[16, 16]} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={24} md={8}>
          <Card title="📈 7日活跃用户" size="small">
            <MiniBarChart data={dauTrend} color="#52c41a" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="📝 7日作业提交" size="small">
            <MiniBarChart data={submissionTrend} color="#1890ff" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="📚 7日作业发布" size="small">
            <MiniBarChart data={assignmentTrend} color="#722ed1" />
          </Card>
        </Col>
      </Row>

      {/* 教师活跃度排行 + 最近事件 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="👩‍🏫 教师活跃度（近30天）" size="small">
            {teacherActivity.length > 0 ? (
              <Table
                dataSource={teacherActivity}
                rowKey="teacher_id"
                size="small"
                pagination={false}
                columns={[
                  { title: '教师', dataIndex: 'real_name', key: 'username', width: 100, render: (v: string, r: any) => v || r.username },
                  { title: '布置作业', dataIndex: 'assignment_count', key: 'assignment_count', width: 80, render: (v: number) => <Tag color="blue">{v}</Tag> },
                  { title: '收到提交', dataIndex: 'submission_count', key: 'submission_count', width: 80, render: (v: number) => <Tag color="green">{v}</Tag> },
                  { title: '待批改', dataIndex: 'ungraded_count', key: 'ungraded_count', width: 80, render: (v: number) => v > 0 ? <Tag color="warning">{v}</Tag> : <Tag color="default">0</Tag> },
                ]}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: '#bbb' }}>暂无教师活动数据</div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="🔔 最近事件" size="small">
            {recentEvents.length > 0 ? (
              <List
                size="small"
                dataSource={recentEvents}
                renderItem={(item: any) => (
                  <List.Item style={{ padding: '8px 0' }}>
                    <Space>
                      <span>{eventIconMap[item.type] || '📌'}</span>
                      <span style={{ fontSize: 13 }}>{item.message}</span>
                      <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap' }}>{new Date(item.time).toLocaleDateString()}</span>
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 20, color: '#bbb' }}>暂无事件</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 班级排行 + 商品排行（保留原有） */}
      <Row gutter={[16, 16]} style={{ marginTop: isMobile ? 12 : 20 }}>
        <Col xs={24} lg={12}>
          <Card title="🏆 班级经验排行" size="small">
            <List
              size="small"
              dataSource={statistics.top_classes}
              renderItem={(item: any, index: number) => (
                <List.Item>
                  <Space>
                    <Badge count={index + 1} style={{ backgroundColor: index < 3 ? '#f5222d' : '#999' }} />
                    <span>{item.name}</span>
                    <Tag>班主任: {item.teacher_name || '未分配'}</Tag>
                    <Tag color="orange">学生: {item.student_count}</Tag>
                    <Tag color="green">经验: {item.total_exp}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="🛒 商品销售排行" size="small">
            <Table
              dataSource={statistics.top_selling_items}
              rowKey="id"
              size="small"
              pagination={false}
              columns={[
                { title: '排名', render: (_: any, __: any, index: number) => index + 1, width: 50 },
                { title: '商品', dataIndex: 'name', key: 'name' },
                { title: '稀有度', dataIndex: 'rarity', key: 'rarity', width: 80, render: (v: string) => <Tag color={v === 'legendary' ? 'gold' : v === 'epic' ? 'purple' : v === 'rare' ? 'blue' : v === 'uncommon' ? 'green' : 'default'}>{v}</Tag> },
                { title: '购买次数', dataIndex: 'purchase_count', key: 'purchase_count', width: 80 },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export { Dashboard };
export default Dashboard;
