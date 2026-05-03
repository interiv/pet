import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Progress, Button, List, Tag, Spin, Empty, Badge } from 'antd';
import {
  HeartOutlined,
  ThunderboltOutlined,
  SmileOutlined,
  TrophyOutlined,
  FireOutlined,
  BookOutlined,
  StarOutlined,
  ShoppingCartOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { battleAPI, bossBattleAPI, leaderboardAPI } from '../utils/api';
import { getPetThumbUrl } from '../utils/petImage';
import { useAuthStore, usePetStore } from '../store/authStore';
import { useSearchParams } from 'react-router-dom';

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

interface StudentDashboardProps {
  onNavigate: (menu: string) => void;
}

const StudentDashboard: React.FC<StudentDashboardProps> = ({ onNavigate }) => {
  const { user } = useAuthStore();
  const { pet } = usePetStore();
  const isMobile = useMobile();
  const [, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [activeBoss, setActiveBoss] = useState<any>(null);
  const [recentBattles, setRecentBattles] = useState<any[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, [user]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const promises: Promise<any>[] = [
        leaderboardAPI.getLevelLeaderboard().then(r => {
          const lb = r.data.leaderboard || [];
          setLeaderboard(lb.slice(0, 5));
          const idx = lb.findIndex((item: any) => item.user_id === user?.id);
          setMyRank(idx >= 0 ? idx + 1 : null);
        }).catch(() => {}),
      ];

      if (user?.class_id) {
        promises.push(
          bossBattleAPI.getCurrentBoss(user.class_id).then(r => {
            setActiveBoss(r.data.boss);
          }).catch(() => {})
        );
      }

      promises.push(
        battleAPI.getBattleHistory().then(r => {
          setRecentBattles((r.data.battles || []).slice(0, 5));
        }).catch(() => {})
      );

      await Promise.all(promises);
    } catch (error) {
      console.error('加载仪表盘数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
  }

  const hungerPercent = pet ? Math.round((pet.hunger / 100) * 100) : 0;
  const moodPercent = pet ? Math.round((pet.mood / 100) * 100) : 0;
  const staminaPercent = pet ? Math.round((pet.stamina / 100) * 100) : 0;
  const healthPercent = pet ? Math.round((pet.health / 100) * 100) : 0;

  const getHungerColor = () => {
    if (hungerPercent > 60) return '#52c41a';
    if (hungerPercent > 30) return '#faad14';
    return '#f5222d';
  };

  const getMoodColor = () => {
    if (moodPercent > 60) return '#52c41a';
    if (moodPercent > 30) return '#faad14';
    return '#f5222d';
  };

  return (
    <div>
      {!pet ? (
        <Card style={{ borderRadius: 12, textAlign: 'center', padding: isMobile ? 20 : 40 }}>
          <Empty description="你还没有宠物，快去创建一只吧！" />
          <Button type="primary" size="large" onClick={() => onNavigate('pet')} style={{ marginTop: 16 }}>
            去创建宠物
          </Button>
        </Card>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={14}>
              <Card
                style={{
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: '#fff',
                  overflow: 'hidden',
                }}
                bodyStyle={isMobile ? { padding: 16 } : undefined}
              >
                <Row gutter={[16, 16]} align="middle">
                  <Col xs={24} sm={10} style={{ textAlign: 'center' }}>
                    {(() => {
                      const imageUrl = getPetThumbUrl(pet);
                      return imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('/')) ? (
                        <img src={imageUrl} alt={pet.name} style={{ maxHeight: isMobile ? 120 : 160, maxWidth: '100%', filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.3))' }} />
                      ) : (
                        <span style={{ fontSize: isMobile ? 72 : 100 }}>{imageUrl || '🐾'}</span>
                      );
                    })()}
                    <h2 style={{ color: '#fff', margin: '8px 0 4px', fontSize: isMobile ? 18 : undefined }}>{pet.name}</h2>
                    <Tag color="gold" style={{ fontSize: isMobile ? 12 : 14 }}>Lv.{pet.level} {pet.species_name}</Tag>
                  </Col>
                  <Col xs={24} sm={14}>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span><HeartOutlined /> 饱腹度</span>
                        <span>{pet.hunger}/100</span>
                      </div>
                      <Progress percent={hungerPercent} strokeColor={getHungerColor()} trailColor="rgba(255,255,255,0.2)" size="small" showInfo={false} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span><SmileOutlined /> 心情</span>
                        <span>{pet.mood}/100</span>
                      </div>
                      <Progress percent={moodPercent} strokeColor={getMoodColor()} trailColor="rgba(255,255,255,0.2)" size="small" showInfo={false} />
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span><ThunderboltOutlined /> 体力</span>
                        <span>{pet.stamina}/100</span>
                      </div>
                      <Progress percent={staminaPercent} strokeColor="#1890ff" trailColor="rgba(255,255,255,0.2)" size="small" showInfo={false} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span>❤️ 健康</span>
                        <span>{pet.health}/100</span>
                      </div>
                      <Progress percent={healthPercent} strokeColor="#eb2f96" trailColor="rgba(255,255,255,0.2)" size="small" showInfo={false} />
                    </div>
                  </Col>
                </Row>
              </Card>
            </Col>

            <Col xs={24} md={10}>
              <Card title="快捷操作" size="small" style={{ borderRadius: 12, height: '100%' }}>
                <Row gutter={[8, 8]}>
                  <Col xs={12} span={12}>
                    <Button block icon={<ShoppingCartOutlined />} onClick={() => onNavigate('pet')} style={{ height: isMobile ? 40 : 48, fontSize: isMobile ? 13 : undefined }}>
                      喂食
                    </Button>
                  </Col>
                  <Col xs={12} span={12}>
                    <Button block icon={<StarOutlined />} onClick={() => onNavigate('pet')} style={{ height: isMobile ? 40 : 48, fontSize: isMobile ? 13 : undefined }}>
                      技能
                    </Button>
                  </Col>
                  <Col xs={12} span={12}>
                    <Button block icon={<BookOutlined />} onClick={() => onNavigate('study')} style={{ height: isMobile ? 40 : 48, fontSize: isMobile ? 13 : undefined }}>
                      学习
                    </Button>
                  </Col>
                  <Col xs={12} span={12}>
                    <Button block icon={<TrophyOutlined />} onClick={() => {
                      setSearchParams({ menu: 'pet', tab: 'pvp' }, { replace: true });
                      onNavigate('pet');
                    }} style={{ height: isMobile ? 40 : 48, fontSize: isMobile ? 13 : undefined }}>
                      挑战
                    </Button>
                  </Col>
                </Row>

                <div style={{ marginTop: 16 }}>
                  <Row gutter={8}>
                    <Col span={8}>
                      <Statistic title="经验" value={pet.exp} suffix={`/ ${pet.level * 100}`} valueStyle={{ fontSize: isMobile ? 14 : 16, color: '#52c41a' }} />
                    </Col>
                    <Col span={8}>
                      <Statistic title="金币" value={user?.gold || 0} valueStyle={{ fontSize: isMobile ? 14 : 16, color: '#faad14' }} />
                    </Col>
                    <Col span={8}>
                      <Statistic title="胜场" value={pet.win_count || 0} valueStyle={{ fontSize: isMobile ? 14 : 16, color: '#1890ff' }} />
                    </Col>
                  </Row>
                </div>
              </Card>
            </Col>
          </Row>

          {activeBoss && (
            <Card
              style={{
                marginTop: 16,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #f5222d 0%, #fa8c16 100%)',
                color: '#fff',
                cursor: 'pointer',
              }}
              onClick={() => {
                setSearchParams({ menu: 'pet', tab: 'boss' }, { replace: true });
                onNavigate('pet');
              }}
            >
              <Row align="middle" justify="space-between" wrap>
                <Col xs={24} sm={20} style={{ marginBottom: isMobile ? 8 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <FireOutlined style={{ fontSize: isMobile ? 24 : 32 }} />
                    <div>
                      <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 'bold' }}>BOSS战进行中！</div>
                      <div style={{ fontSize: isMobile ? 12 : undefined }}>{activeBoss.boss_name} Lv.{activeBoss.boss_level} · 进度 {activeBoss.progress}%</div>
                    </div>
                  </div>
                </Col>
                <Col>
                  <Button ghost icon={<ArrowRightOutlined />} size={isMobile ? 'small' : 'middle'}>立即参战</Button>
                </Col>
              </Row>
            </Card>
          )}

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} md={12}>
              <Card
                title="🏆 班级排行"
                size="small"
                style={{ borderRadius: 12 }}
                extra={<Button type="link" size="small" onClick={() => onNavigate('home')}>查看全部</Button>}
              >
                {myRank && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fff7e6', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>你的排名</span>
                    <Tag color="gold" style={{ fontSize: 16, padding: '2px 12px' }}>第 {myRank} 名</Tag>
                  </div>
                )}
                <List
                  size="small"
                  dataSource={leaderboard}
                  renderItem={(item: any, index: number) => (
                    <List.Item>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                        <Badge count={index + 1} style={{ backgroundColor: index < 3 ? '#faad14' : '#d9d9d9' }} />
                        <span style={{ flex: 1 }}>{item.name}</span>
                        <Tag>Lv.{item.level}</Tag>
                      </div>
                    </List.Item>
                  )}
                  locale={{ emptyText: '暂无排行数据' }}
                />
              </Card>
            </Col>

            <Col xs={24} md={12}>
              <Card
                title="⚔️ 最近战斗"
                size="small"
                style={{ borderRadius: 12 }}
                extra={<Button type="link" size="small" onClick={() => onNavigate('arena')}>查看全部</Button>}
              >
                <List
                  size="small"
                  dataSource={recentBattles}
                  renderItem={(item: any) => {
                    const isWinner = item.winner_id === pet?.id;
                    const opponentName = item.pet1_id === pet?.id ? item.pet2_name : item.pet1_name;
                    return (
                      <List.Item>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                          <span>vs {opponentName}</span>
                          <Tag color={isWinner ? 'success' : 'error'}>{isWinner ? '胜利' : '失败'}</Tag>
                        </div>
                      </List.Item>
                    );
                  }}
                  locale={{ emptyText: '暂无战斗记录，去挑战吧！' }}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
};

export default StudentDashboard;
