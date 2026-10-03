import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Progress, Tag, message, Tabs, TabsProps, Badge, Tooltip , Alert, Button, Typography } from 'antd';
import { TrophyOutlined, CheckCircleOutlined, StarOutlined, LockOutlined, CrownOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { achievementAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const { Text } = Typography;

interface Achievement {
  id: number;
  name: string;
  description: string;
  icon?: string;
  category?: string;
  condition?: string;
  reward_type?: string;
  reward_value?: number;
  completed?: boolean;
  progress?: number;
  completed_at?: string;
}

const categoryNames: Record<string, string> = {
  'battle': '战斗成就',
  'pet': '宠物成就',
  'learning': '学习成就',
  'social': '社交成就',
  'collection': '收集成就',
  'special': '综合成就',
};

const categoryColors: Record<string, string> = {
  'battle': '#ff4d4f',
  'pet': '#52c41a',
  'learning': '#1677ff',
  'social': '#722ed1',
  'collection': '#faad14',
  'special': '#8c8c8c',
};

const Achievements: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      loadAchievements();
    }
  }, [isAuthenticated]);

  const loadAchievements = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const res = await achievementAPI.getAchievementStatus();
      const list = res.data.achievements || [];
      setAchievements(list);
      setTotal(res.data.total ?? list.length);
      setLoadFailed(false);
    } catch (error) {
      console.error('加载成就失败:', error);
      // 之前这里只弹提示、数组保持空，页面会显示成「0 / 0」，让人误以为成就丢了
      setLoadFailed(true);
      message.error('加载成就失败，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  };

  const getCompletedCount = () => {
    return achievements.filter(a => a.completed).length;
  };

  // 分母优先用后端给的 total，避免接口异常时被算成 0
  const getTotalCount = () => total || achievements.length;

  const getProgressByCategory = (category: string) => {
    const categoryAchievements = achievements.filter(a => (a.category || 'special') === category);
    if (categoryAchievements.length === 0) return 0;
    const completed = categoryAchievements.filter(a => a.completed);
    return Math.round((completed.length / categoryAchievements.length) * 100);
  };

  const renderAchievementCard = (achievement: Achievement) => {
    const completed = !!achievement.completed;
    const category = achievement.category || 'special';

    const tooltipTitle = completed && achievement.completed_at
      ? `完成时间: ${new Date(achievement.completed_at).toLocaleString('zh-CN')}`
      : '';

    return (
      // Tooltip 的子节点需要能接收 ref，Badge.Ribbon 不支持，
      // 直接嵌套会触发 antd 内部的 findDOMNode 弃用告警，故包一层 div。
      <Tooltip title={tooltipTitle}>
        <div>
          <Badge.Ribbon
          text={completed ? <><CheckCircleOutlined /> 已解锁</> : <><LockOutlined /> 未解锁</>}
          color={completed ? 'green' : 'default'}
          style={{ display: completed ? 'block' : 'none' }}
        >
          <Card
            size="small"
            hoverable
            style={{
              borderRadius: 12,
              background: completed 
                ? 'linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%)' 
                : '#fafafa',
              border: completed ? '2px solid #52c41a' : '1px solid #f0f0f0',
              transition: 'all 0.3s ease',
              animation: completed ? 'achievement-glow 2s ease-in-out infinite' : 'none'
            }}
            className={completed ? 'achievement-unlocked' : 'achievement-locked'}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                fontSize: 36,
                width: 56,
                height: 56,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: completed ? 'linear-gradient(135deg, #fff7e6 0%, #ffe58f 100%)' : '#e8e8e8',
                borderRadius: 12,
                opacity: completed ? 1 : 0.35,
                boxShadow: completed ? '0 4px 12px rgba(250, 173, 20, 0.4)' : 'none',
                transition: 'all 0.3s ease',
                position: 'relative'
              }}>
                {achievement.icon || '🏆'}
                {completed && <div style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#52c41a', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: '#fff'
                }}><CheckCircleOutlined /></div>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 'bold', fontSize: 15, color: completed ? '#389e0d' : '#333' }}>
                    {achievement.name}
                  </span>
                  {completed && <CrownOutlined style={{ color: '#faad14' }} />}
                </div>
                <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                  {achievement.description}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Tag color={categoryColors[category] || 'default'}>
                    {categoryNames[category] || category}
                  </Tag>
                  {achievement.reward_type && (
                    <Tag color="gold">
                      🎁 {achievement.reward_value} {achievement.reward_type === 'exp' ? '经验' : achievement.reward_type === 'gold' ? '金币' : '物品'}
                    </Tag>
                  )}
                </div>
                {achievement.progress !== undefined && (
                  <Progress
                    percent={achievement.progress}
                    size="small"
                    style={{ marginTop: 8, marginBottom: 0 }}
                    strokeColor={completed ? '#52c41a' : '#1677ff'}
                    format={(percent) => `${percent}%`}
                  />
                )}
              </div>
            </div>
          </Card>
          </Badge.Ribbon>
        </div>
      </Tooltip>
    );
  };

  if (!isAuthenticated) {
    return (
      <Card style={{ borderRadius: '12px', textAlign: 'center', padding: '40px' }}>
        <h3 style={{ color: '#999', marginBottom: 20 }}>未登录无法查看成就</h3>
      </Card>
    );
  }

  const groupedAchievements: Record<string, Achievement[]> = {};
  achievements.forEach(a => {
    const category = a.category || 'special';
    if (!groupedAchievements[category]) {
      groupedAchievements[category] = [];
    }
    groupedAchievements[category].push(a);
  });

  const tabItems: TabsProps['items'] = [
    {
      key: 'all',
      label: <span><TrophyOutlined /> 全部成就</span>,
      children: (
        <div>
          {loadFailed && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message="成就数据加载失败"
              description="下方列表为空不代表成就不存在，请检查网络后重试。"
              action={<Button size="small" onClick={loadAchievements}>重新加载</Button>}
            />
          )}
          <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                「全部成就」= 不做筛选，显示所有成就；其他标签只是按类别筛选，与它并列。
              </Text>
              <Progress
                type="circle"
                size={54}
                percent={getTotalCount() > 0 ? Math.round((getCompletedCount() / getTotalCount()) * 100) : 0}
                format={() => `${getCompletedCount()}/${getTotalCount()}`}
              />
            </div>
          </Card>

          <Row gutter={[16, 16]}>
            {achievements.map(achievement => (
              <Col xs={24} sm={12} md={8} lg={6} key={achievement.id}>
                {renderAchievementCard(achievement)}
              </Col>
            ))}
          </Row>
        </div>
      )
    },
    ...Object.entries(groupedAchievements).map(([category, categoryAchievements]) => ({
      key: category,
      label: <span><StarOutlined /> {categoryNames[category] || category}</span>,
      children: (
        <div>
          <Card style={{ marginBottom: 16, background: categoryColors[category], borderRadius: 12 }}>
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <div style={{ fontSize: 16, marginBottom: 8 }}>{categoryNames[category] || category}</div>
              <Progress
                percent={getProgressByCategory(category)}
                showInfo={true}
                strokeColor="#fff"
              />
            </div>
          </Card>

          <Row gutter={[16, 16]}>
            {categoryAchievements.map(achievement => (
              <Col xs={24} sm={12} md={8} lg={6} key={achievement.id}>
                {renderAchievementCard(achievement)}
              </Col>
            ))}
          </Row>
        </div>
      )
    }))
  ];

  return (
    <div>
      {/* 概览条：侧边栏已经有「成就」这一项，这里不再重复大标题，
          否则会出现「成就 → 成就中心 → 全部成就」三层套娃 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginBottom: 12,
        padding: '12px 16px', borderRadius: 12,
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}>
        <div style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
          <TrophyOutlined style={{ fontSize: 22 }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>成就进度</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              共 {getTotalCount()} 个成就，已解锁 {getCompletedCount()} 个
            </div>
          </div>
        </div>
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 'bold' }}>
          {loading ? '加载中...' : `${getCompletedCount()} / ${getTotalCount()}`}
        </div>
      </div>

      <Tabs
        activeKey={searchParams.get('sub') || 'all'}
        onChange={(key) => {
          setSearchParams(prev => {
            prev.set('sub', key);
            return prev;
          }, { replace: true });
        }}
        items={tabItems}
      />
      
      {/* CSS动画 */}
      <style>{`
        @keyframes achievement-glow {
          0%, 100% {
            box-shadow: 0 0 5px rgba(82, 196, 26, 0.3);
          }
          50% {
            box-shadow: 0 0 20px rgba(82, 196, 26, 0.6);
          }
        }
        
        .achievement-unlocked:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 16px rgba(82, 196, 26, 0.3);
        }
        
        .achievement-locked:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
      `}</style>
    </div>
  );
};

export default Achievements;