import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Button, List, Tag, Spin, Empty, Segmented } from 'antd';
import {
  TeamOutlined,
  TrophyOutlined,
  BookOutlined,
  ThunderboltOutlined,
  ArrowRightOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { adminAPI, leaderboardAPI, knowledgePointAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

interface TeacherDashboardProps {
  onNavigate: (menu: string) => void;
}

const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ onNavigate }) => {
  const { user } = useAuthStore();
  const [, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [classOverview, setClassOverview] = useState<any>(null);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [myClasses, setMyClasses] = useState<any[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, [user]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const statsRes = await adminAPI.getStatistics();
      setStats(statsRes.data.statistics);

      const classes = statsRes.data.statistics?.classes?.list || [];
      setMyClasses(classes);

      if (classes.length > 0) {
        const firstClassId = classes[0].id;
        setSelectedClassId(firstClassId);

        const [lbRes, overviewRes] = await Promise.all([
          leaderboardAPI.getLevelLeaderboard({ class_id: firstClassId, limit: 5 }),
          knowledgePointAPI.getClassOverview(firstClassId, { days: 14 }).catch(() => ({ data: null })),
        ]);

        setLeaderboard(lbRes.data.leaderboard || []);
        setClassOverview(overviewRes.data);
      }
    } catch (error) {
      console.error('加载教师仪表盘失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClassChange = async (classId: number) => {
    setSelectedClassId(classId);
    try {
      const [lbRes, overviewRes] = await Promise.all([
        leaderboardAPI.getLevelLeaderboard({ class_id: classId, limit: 5 }),
        knowledgePointAPI.getClassOverview(classId, { days: 14 }).catch(() => ({ data: null })),
      ]);
      setLeaderboard(lbRes.data.leaderboard || []);
      setClassOverview(overviewRes.data);
    } catch (error) {
      console.error('切换班级数据失败:', error);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
  }

  const selectedClassName = myClasses.find((c: any) => c.id === selectedClassId)?.name || '';

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic
              title="任教班级"
              value={stats?.classes?.total || 0}
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic
              title="学生总数"
              value={stats?.users?.students || 0}
              prefix={<UserOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic
              title="今日活跃"
              value={stats?.daily?.active_users || 0}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic
              title="今日发金"
              value={stats?.daily?.gold_distributed || 0}
              prefix={<TrophyOutlined />}
              valueStyle={{ color: '#eb2f96' }}
            />
          </Card>
        </Col>
      </Row>

      {myClasses.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <Segmented
            options={myClasses.map((c: any) => ({ label: c.name, value: c.id }))}
            value={selectedClassId || undefined}
            onChange={(value) => handleClassChange(value as number)}
          />
        </div>
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={14}>
          <Card
            title={`📊 ${selectedClassName} 学情概览`}
            size="small"
            style={{ borderRadius: 12 }}
            extra={
              <Button type="link" size="small" onClick={() => {
                setSearchParams({ menu: 'study', tab: 'dashboard' }, { replace: true });
                onNavigate('study');
              }}>
                详细数据 <ArrowRightOutlined />
              </Button>
            }
          >
            {classOverview ? (
              <>
                <Row gutter={16} style={{ marginBottom: 16 }}>
                  <Col span={8}>
                    <Statistic
                      title="平均正确率"
                      value={classOverview.avg_accuracy || 0}
                      suffix="%"
                      valueStyle={{ fontSize: 24, color: (classOverview.avg_accuracy || 0) >= 60 ? '#52c41a' : '#f5222d' }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="答题总数"
                      value={classOverview.total_attempts || 0}
                      valueStyle={{ fontSize: 24 }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="知识点覆盖"
                      value={classOverview.knowledge_point_count || 0}
                      valueStyle={{ fontSize: 24, color: '#722ed1' }}
                    />
                  </Col>
                </Row>

                {classOverview.top_weak && classOverview.top_weak.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 8, color: '#f5222d' }}>
                      <WarningOutlined /> 薄弱知识点
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {classOverview.top_weak.slice(0, 5).map((kp: any, idx: number) => (
                        <Tag key={idx} color="error">
                          {kp.knowledge_point} ({kp.accuracy}%)
                        </Tag>
                      ))}
                    </div>
                  </div>
                )}

                {classOverview.top_mastered && classOverview.top_mastered.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: 8, color: '#52c41a' }}>
                      <CheckCircleOutlined /> 已掌握知识点
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {classOverview.top_mastered.slice(0, 5).map((kp: any, idx: number) => (
                        <Tag key={idx} color="success">
                          {kp.knowledge_point} ({kp.accuracy}%)
                        </Tag>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Empty description="暂无学情数据" />
            )}
          </Card>
        </Col>

        <Col xs={24} md={10}>
          <Card
            title={`🏆 ${selectedClassName} 排行`}
            size="small"
            style={{ borderRadius: 12 }}
            extra={
              <Button type="link" size="small" onClick={() => onNavigate('home')}>
                查看全部
              </Button>
            }
          >
            <List
              size="small"
              dataSource={leaderboard}
              renderItem={(item: any, index: number) => (
                <List.Item>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <Tag color={index < 3 ? 'gold' : 'default'}>{index + 1}</Tag>
                    <span style={{ flex: 1 }}>{item.name}</span>
                    <span style={{ color: '#999', fontSize: 12 }}>{item.owner_name}</span>
                    <Tag>Lv.{item.level}</Tag>
                  </div>
                </List.Item>
              )}
              locale={{ emptyText: '暂无排行数据' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12}>
          <Button block size="large" icon={<BookOutlined />} onClick={() => {
            setSearchParams({ menu: 'study', tab: 'assignments' }, { replace: true });
            onNavigate('study');
          }} style={{ height: 56, borderRadius: 12 }}>
            布置作业
          </Button>
        </Col>
        <Col xs={24} sm={12}>
          <Button block size="large" icon={<TeamOutlined />} onClick={() => {
            setSearchParams({ menu: 'study', tab: 'dashboard' }, { replace: true });
            onNavigate('study');
          }} style={{ height: 56, borderRadius: 12 }}>
            班级详情
          </Button>
        </Col>
      </Row>
    </div>
  );
};

export default TeacherDashboard;
