import React, { useEffect, useState } from 'react';
import { Card, Progress, Button, List, Avatar, Tag, message, Statistic, Row, Col, Badge, Empty, Spin } from 'antd';
import {
  ThunderboltOutlined,
  TrophyOutlined,
  TeamOutlined,
  FireOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000/api';

const BossBattle: React.FC = () => {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [bossData, setBossData] = useState<any>(null);
  const [attacking, setAttacking] = useState(false);

  useEffect(() => {
    if (user?.class_id) {
      loadBoss();
    }
  }, [user]);

  const loadBoss = async () => {
    if (!user?.class_id) return;
    
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_BASE_URL}/boss-battles/current/${user.class_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBossData(response.data);
    } catch (error: any) {
      console.error('加载BOSS失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAttack = async () => {
    if (!bossData?.boss) return;

    try {
      setAttacking(true);
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/boss-battles/${bossData.boss.id}/attack`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      message.success(response.data.message);
      
      if (response.data.boss_defeated) {
        message.success('🎉 恭喜!BOSS被击败了!');
      }
      
      loadBoss();
    } catch (error: any) {
      message.error(error.response?.data?.error || '攻击失败');
    } finally {
      setAttacking(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#999' }}>加载BOSS信息中...</div>
      </div>
    );
  }

  if (!bossData?.boss) {
    return (
      <div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FireOutlined style={{ color: '#f5222d', fontSize: 28 }} />
          班级BOSS战
        </h2>
        <Empty
          description="当前没有活跃的BOSS，等待教师创建或从错题生成"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ marginTop: 40 }}
        />
      </div>
    );
  }

  const boss = bossData.boss;
  const timeLeft = Math.max(0, Math.floor((new Date(boss.expires_at).getTime() - Date.now()) / (1000 * 60 * 60)));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FireOutlined style={{ color: '#f5222d', fontSize: 28 }} />
          班级BOSS战
        </h2>
        <p style={{ color: '#666', margin: '8px 0 0' }}>
          全班同学一起击败BOSS，获得丰厚奖励！
        </p>
      </div>

      {/* BOSS信息 */}
      <Card
        style={{
          marginBottom: 20,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: '#fff',
          borderRadius: 12
        }}
      >
        <Row gutter={[24, 24]} align="middle">
          <Col xs={24} md={8} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 120, marginBottom: 16, animation: 'boss-float 3s ease-in-out infinite' }}>
              {boss.boss_icon || '👹'}
            </div>
            <h2 style={{ color: '#fff', margin: '0 0 8px' }}>{boss.boss_name}</h2>
            <Tag color="red">Lv.{boss.boss_level}</Tag>
            {boss.knowledge_point && (
              <Tag color="blue" style={{ marginLeft: 8 }}>{boss.knowledge_point}</Tag>
            )}
          </Col>
          
          <Col xs={24} md={16}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>BOSS血量</span>
                <span>{boss.current_hp} / {boss.boss_max_hp}</span>
              </div>
              <Progress
                percent={boss.progress}
                strokeColor={{ from: '#f5222d', to: '#fa8c16' }}
                trailColor="rgba(255,255,255,0.2)"
                strokeWidth={24}
                format={() => `${boss.progress}%`}
              />
            </div>

            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title="参与人数"
                  value={boss.participant_count}
                  prefix={<TeamOutlined />}
                  valueStyle={{ color: '#fff' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="剩余时间"
                  value={timeLeft}
                  suffix="小时"
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: '#fff' }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="BOSS等级"
                  value={boss.boss_level}
                  prefix={<ThunderboltOutlined />}
                  valueStyle={{ color: '#fff' }}
                />
              </Col>
            </Row>

            <Button
              type="primary"
              size="large"
              block
              icon={<FireOutlined />}
              loading={attacking}
              onClick={handleAttack}
              style={{
                marginTop: 24,
                height: 56,
                fontSize: 20,
                background: '#fff',
                color: '#764ba2',
                border: 'none',
                fontWeight: 'bold'
              }}
            >
              ⚔️ 攻击BOSS
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 伤害排行榜 */}
      <Card title="🏆 伤害排行榜" size="small">
        <List
          dataSource={bossData.leaderboard || []}
          renderItem={(item: any, index) => (
            <List.Item>
              <List.Item.Meta
                avatar={
                  <Badge count={index + 1} offset={[-5, 5]}>
                    <Avatar 
                      size={48}
                      style={{ backgroundColor: index < 3 ? '#f5222d' : '#d9d9d9' }}
                    >
                      {item.username?.charAt(0)}
                    </Avatar>
                  </Badge>
                }
                title={
                  <div>
                    <span style={{ fontWeight: 'bold' }}>{item.username}</span>
                    {item.pet_name && (
                      <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>
                        ({item.pet_name} Lv.{item.pet_level})
                      </span>
                    )}
                  </div>
                }
                description={`造成伤害: ${item.damage_dealt} | 正确答题: ${item.correct_answers}`}
              />
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#f5222d' }}>
                  {item.damage_dealt}
                </div>
                <div style={{ color: '#999', fontSize: 12 }}>伤害值</div>
              </div>
            </List.Item>
          )}
        />
      </Card>

      {/* CSS动画 */}
      <style>{`
        @keyframes boss-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );
};

export default BossBattle;
