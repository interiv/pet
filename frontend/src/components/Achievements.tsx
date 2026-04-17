import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Progress, Tag, message, Tabs, TabsProps, Badge, Tooltip, Empty, Statistic } from 'antd';
import { TrophyOutlined, CheckCircleOutlined, StarOutlined, LockOutlined, CrownOutlined, FireOutlined } from '@ant-design/icons';
import { achievementAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

interface Achievement {
  id: number;
  name: string;
  description: string;
  icon?: string;
  condition?: string;
  reward_type?: string;
  reward_value?: number;
}

interface UserAchievement {
  id: number;
  achievement_id: number;
  completed: boolean;
  progress?: number;
  completed_at?: string;
  achievement?: Achievement;
}

const categoryNames: Record<string, string> = {
  'battle': '战斗成就',
  'pet': '宠物成就',
  'social': '社交成就',
  'collection': '收集成就',
  'special': '特殊成就'
};

const categoryColors: Record<string, string> = {
  'battle': '#ff4d4f',
  'pet': '#52c41a',
  'social': '#1890ff',
  'collection': '#faad14',
  'special': '#722ed1'
};

const inferCategory = (condition: string): string => {
  try {
    const cond = JSON.parse(condition);
    if (cond.type.includes('battle') || cond.type.includes('win') || cond.type.includes('streak')) return 'battle';
    if (cond.type.includes('pet') || cond.type.includes('level') || cond.type.includes('create_pet')) return 'pet';
    if (cond.type.includes('friend') || cond.type.includes('social')) return 'social';
    if (cond.type.includes('collect') || cond.type.includes('equipment')) return 'collection';
    return 'special';
  } catch {
    return 'special';
  }
};

const Achievements: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [myAchievements, setMyAchievements] = useState<UserAchievement[]>([]);

  useEffect(() => {
    if (isAuthenticated) {
      loadAchievements();
    }
  }, [isAuthenticated]);

  const loadAchievements = async () => {
    if (!isAuthenticated) return;
    try {
      const [allRes, myRes] = await Promise.all([
        achievementAPI.getAchievements(),
        achievementAPI.getAchievementStatus()
      ]);
      setAchievements(allRes.data.achievements || []);
      setMyAchievements(myRes.data.achievements || []);
    } catch (error) {
      console.error('加载成就失败:', error);
      message.error('加载成就失败');
    }
  };

  const isCompleted = (achievementId: number) => {
    return myAchievements.find(ma => ma.achievement_id === achievementId && ma.completed);
  };

  const getUserAchievement = (achievementId: number) => {
    return myAchievements.find(ma => ma.achievement_id === achievementId);
  };

  const getCompletedCount = () => {
    return myAchievements.filter(ma => ma.completed).length;
  };

  const getTotalCount = () => {
    return achievements.length;
  };

  const getProgressByCategory = (category: string) => {
    const categoryAchievements = achievements.filter(a => inferCategory(a.condition || '') === category);
    if (categoryAchievements.length === 0) return 0;
    const completed = categoryAchievements.filter(a => isCompleted(a.id));
    return Math.round((completed.length / categoryAchievements.length) * 100);
  };

  const renderAchievementCard = (achievement: Achievement) => {
    const completed = isCompleted(achievement.id);
    const userAch = getUserAchievement(achievement.id);
    const category = inferCategory(achievement.condition || '');
    const completedAt = userAch?.completed_at;

    return (
      <Tooltip title={completed && completedAt ? `完成时间: ${new Date(completedAt).toLocaleString('zh-CN')}` : ''}>
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
                background: completed ? '#fff' : '#f5f5f5',
                borderRadius: 12,
                filter: completed ? 'none' : 'grayscale(100%)',
                opacity: completed ? 1 : 0.5,
                boxShadow: completed ? '0 4px 12px rgba(82, 196, 26, 0.3)' : 'none',
                transition: 'all 0.3s ease'
              }}>
                {achievement.icon || '🏆'}
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
                {userAch?.progress !== undefined && !completed && (
                  <Progress
                    percent={userAch.progress}
                    size="small"
                    style={{ marginTop: 8, marginBottom: 0 }}
                    strokeColor="#52c41a"
                    format={(percent) => `${percent}%`}
                  />
                )}
              </div>
            </div>
          </Card>
        </Badge.Ribbon>
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
    const category = inferCategory(a.condition || '');
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
          <Card style={{ marginBottom: 16, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: 12 }}>
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <div style={{ fontSize: 16, marginBottom: 8 }}>成就进度</div>
              <div style={{ fontSize: 32, fontWeight: 'bold' }}>
                {getCompletedCount()} / {getTotalCount()}
              </div>
              <Progress
                percent={getTotalCount() > 0 ? Math.round((getCompletedCount() / getTotalCount()) * 100) : 0}
                showInfo={false}
                strokeColor="#fff"
                style={{ marginTop: 8 }}
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
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, gap: 12 }}>
        <TrophyOutlined style={{ fontSize: 24, color: '#faad14' }} />
        <h2 style={{ margin: 0 }}>成就中心</h2>
      </div>

      <Tabs defaultActiveKey="all" items={tabItems} />
      
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