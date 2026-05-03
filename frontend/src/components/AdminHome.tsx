import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Spin, Tag, Button, Avatar, Empty, message } from 'antd';
import {
  UserOutlined,
  TeamOutlined,
  FolderOutlined,
  NotificationOutlined,
  SettingOutlined,
  DatabaseOutlined,
  RobotOutlined,
  TrophyOutlined,
  LineChartOutlined,
  RightOutlined,
  ClockCircleOutlined,
  FireOutlined,
} from '@ant-design/icons';
import { adminAPI, leaderboardAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { getPetThumbUrl } from '../utils/petImage';

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

interface AdminHomeProps {
  onNavigate: (menu: string, tab?: string) => void;
}

const MiniBarChart: React.FC<{ data: { date: string; count: number }[]; color?: string; height?: number }> = ({ data, color = '#1890ff', height = 60 }) => {
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

const AdminHome: React.FC<AdminHomeProps> = ({ onNavigate }) => {
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [loading, setLoading] = useState(true);
  const [statistics, setStatistics] = useState<any>(null);
  const [operationalStats, setOperationalStats] = useState<any>(null);
  const [topPets, setTopPets] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, opsRes, lbRes] = await Promise.all([
        adminAPI.getStatistics(),
        adminAPI.getOperationalStats().catch(() => ({ data: {} })),
        leaderboardAPI.getLevelLeaderboard({ limit: 5 }).catch(() => ({ data: { leaderboard: [] } })),
      ]);
      setStatistics(statsRes.data.statistics);
      setOperationalStats(opsRes.data);
      setTopPets(lbRes.data.leaderboard || []);
    } catch (error) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!statistics) return null;

  const ops = operationalStats || {};
  const pendingTeachers = ops.pending?.teachers ?? statistics.status?.pending_teachers ?? 0;
  const pendingApps = ops.pending?.applications ?? 0;
  const dauTrend = ops.trends?.dau || [];
  const submissionTrend = ops.trends?.submissions || [];
  const assignmentTrend = ops.trends?.assignments || [];
  const recentEvents = ops.recent_events || [];

  const eventIconMap: Record<string, string> = {
    register: '👤',
    assignment: '📝',
    announcement: '📢',
  };

  const quickActions = [
    { key: 'teachers', icon: <UserOutlined />, label: '审批教师', tab: 'teachers', color: '#faad14', badge: pendingTeachers },
    { key: 'applications', icon: <TeamOutlined />, label: '入学申请', tab: 'applications', color: '#1890ff', badge: pendingApps },
    { key: 'announcements', icon: <NotificationOutlined />, label: '发布公告', tab: 'announcements', color: '#52c41a' },
    { key: 'site_settings', icon: <SettingOutlined />, label: '网站设置', tab: 'site_settings', color: '#722ed1' },
    { key: 'ai_settings', icon: <RobotOutlined />, label: 'AI设置', tab: 'ai_settings', color: '#13c2c2' },
    { key: 'token_dashboard', icon: <LineChartOutlined />, label: 'Token看板', tab: 'token_dashboard', color: '#eb2f96' },
    { key: 'dataview', icon: <DatabaseOutlined />, label: '数据查看', tab: 'dataview', color: '#fa541c' },
    { key: 'achievements', icon: <TrophyOutlined />, label: '成就管理', tab: 'achievements', color: '#f5222d' },
  ];

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return '夜深了';
    if (hour < 12) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  };

  return (
    <div>
      {/* 欢迎横幅 */}
      <Card
        style={{
          marginBottom: isMobile ? 12 : 20,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          border: 'none',
          borderRadius: 12,
        }}
        styles={{ body: { padding: isMobile ? '16px 20px' : '24px 32px' } }}
      >
        <Row align="middle" justify="space-between">
          <Col>
            <div style={{ color: '#fff', fontSize: isMobile ? 20 : 26, fontWeight: 'bold', marginBottom: 8 }}>
              {greeting()}，{user?.username} 👋
            </div>
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: isMobile ? 13 : 15 }}>
              欢迎回到管理后台，以下是系统运行概览
            </div>
          </Col>
          <Col>
            <Button
              type="primary"
              ghost
              style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.15)' }}
              icon={<SettingOutlined />}
              onClick={() => onNavigate('admin')}
            >
              进入管理后台
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 待处理事项 */}
      {(pendingTeachers > 0 || pendingApps > 0) && (
        <Row gutter={[16, 16]} style={{ marginBottom: isMobile ? 12 : 20 }}>
          {pendingTeachers > 0 && (
            <Col xs={24} sm={12}>
              <Card
                hoverable
                onClick={() => onNavigate('admin', 'teachers')}
                style={{ borderLeft: '4px solid #faad14', cursor: 'pointer' }}
                styles={{ body: { padding: isMobile ? '12px 16px' : '16px 20px' } }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>
                      <ClockCircleOutlined style={{ color: '#faad14', marginRight: 4 }} />
                      待审批教师
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 'bold', color: '#faad14' }}>{pendingTeachers}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color="warning">需处理</Tag>
                    <RightOutlined style={{ color: '#bbb' }} />
                  </div>
                </div>
              </Card>
            </Col>
          )}
          {pendingApps > 0 && (
            <Col xs={24} sm={12}>
              <Card
                hoverable
                onClick={() => onNavigate('admin', 'applications')}
                style={{ borderLeft: '4px solid #1890ff', cursor: 'pointer' }}
                styles={{ body: { padding: isMobile ? '12px 16px' : '16px 20px' } }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>
                      <ClockCircleOutlined style={{ color: '#1890ff', marginRight: 4 }} />
                      待处理入学申请
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 'bold', color: '#1890ff' }}>{pendingApps}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color="processing">需处理</Tag>
                    <RightOutlined style={{ color: '#bbb' }} />
                  </div>
                </div>
              </Card>
            </Col>
          )}
        </Row>
      )}

      {/* 核心指标 */}
      <Row gutter={[16, 16]} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={12} sm={6}>
          <Card hoverable style={{ borderRadius: 8 }}>
            <Statistic
              title="总用户"
              value={statistics.users.total}
              prefix={<UserOutlined style={{ color: '#1890ff' }} />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card hoverable style={{ borderRadius: 8 }}>
            <Statistic
              title="今日活跃"
              value={statistics.daily?.active_users || 0}
              prefix={<FireOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card hoverable style={{ borderRadius: 8 }}>
            <Statistic
              title="班级数"
              value={statistics.classes.total}
              prefix={<FolderOutlined style={{ color: '#722ed1' }} />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card hoverable style={{ borderRadius: 8 }}>
            <Statistic
              title="教师 / 学生"
              value={`${statistics.users.teachers} / ${statistics.users.students}`}
              prefix={<TeamOutlined style={{ color: '#faad14' }} />}
              valueStyle={{ fontSize: 18, color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 趋势图 + 宠物排行 */}
      <Row gutter={[16, 16]} style={{ marginBottom: isMobile ? 12 : 20 }}>
        <Col xs={24} md={16}>
          <Card title="📈 7日趋势" size="small" style={{ borderRadius: 8 }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>活跃用户</div>
                <MiniBarChart data={dauTrend} color="#52c41a" height={80} />
              </Col>
              <Col xs={24} sm={8}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>作业提交</div>
                <MiniBarChart data={submissionTrend} color="#1890ff" height={80} />
              </Col>
              <Col xs={24} sm={8}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>作业发布</div>
                <MiniBarChart data={assignmentTrend} color="#722ed1" height={80} />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card
            title="🐾 宠物排行 Top5"
            size="small"
            style={{ borderRadius: 8 }}
            extra={<a onClick={() => onNavigate('home')}>查看更多</a>}
          >
            {topPets.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topPets.map((pet: any, index: number) => (
                  <div
                    key={pet.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 8px',
                      borderRadius: 8,
                      background: index === 0 ? 'linear-gradient(135deg, #fff7e6 0%, #ffe7ba 100%)' : index === 1 ? 'linear-gradient(135deg, #f0f5ff 0%, #d6e4ff 100%)' : index === 2 ? 'linear-gradient(135deg, #fff1f0 0%, #ffccc7 100%)' : '#fafafa',
                    }}
                  >
                    <span style={{ fontSize: 16, fontWeight: 'bold', color: index < 3 ? ['#faad14', '#1890ff', '#f5222d'][index] : '#999', width: 20, textAlign: 'center' }}>
                      {index + 1}
                    </span>
                    <Avatar
                      size={32}
                      src={getPetThumbUrl(pet)}
                      style={{ background: '#f0f2f5' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pet.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#999' }}>
                        {pet.owner_name}
                      </div>
                    </div>
                    <Tag color={index === 0 ? 'gold' : index === 1 ? 'blue' : index === 2 ? 'red' : 'default'}>
                      Lv.{pet.level}
                    </Tag>
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="暂无排行数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>

      {/* 快捷操作 */}
      <Card title="⚡ 快捷操作" size="small" style={{ marginBottom: isMobile ? 12 : 20, borderRadius: 8 }}>
        <Row gutter={[12, 12]}>
          {quickActions.map(action => (
            <Col xs={12} sm={8} md={6} key={action.key}>
              <Card
                hoverable
                size="small"
                style={{ borderRadius: 8, textAlign: 'center', position: 'relative' }}
                styles={{ body: { padding: isMobile ? '12px 8px' : '16px 12px' } }}
                onClick={() => onNavigate('admin', action.tab)}
              >
                {action.badge > 0 && (
                  <div style={{
                    position: 'absolute', top: -6, right: -6,
                    background: '#f5222d', color: '#fff', borderRadius: 10,
                    fontSize: 11, minWidth: 18, height: 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 4px', fontWeight: 'bold',
                  }}>
                    {action.badge}
                  </div>
                )}
                <div style={{ fontSize: 24, color: action.color, marginBottom: 6 }}>
                  {action.icon}
                </div>
                <div style={{ fontSize: 13, color: '#333' }}>{action.label}</div>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 最近事件 */}
      {recentEvents.length > 0 && (
        <Card title="🕐 最近动态" size="small" style={{ borderRadius: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentEvents.slice(0, 8).map((event: any, index: number) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: index < recentEvents.slice(0, 8).length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                <span style={{ fontSize: 16 }}>{eventIconMap[event.type] || '📌'}</span>
                <span style={{ flex: 1, fontSize: 13, color: '#555' }}>{event.description}</span>
                <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap' }}>
                  {event.time_ago || ''}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default AdminHome;
