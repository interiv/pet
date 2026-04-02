import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Button, Tabs, List, Tag, Statistic, message, Avatar, TabsProps } from 'antd';
import { TrophyOutlined, FireOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { petAPI, battleAPI } from '../utils/api';
import { usePetStore, useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';



const Battle: React.FC = () => {
  const { user } = useAuthStore();
  const { pet } = usePetStore();
  const [opponents, setOpponents] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [battleResult, setBattleResult] = useState<any>(null);
  const [battleModalVisible, setBattleModalVisible] = useState(false);

  useEffect(() => {
    loadOpponents();
    if (user) {
      loadHistory();
    }
  }, [user]);

  const loadOpponents = async () => {
    try {
      const response = await petAPI.getAllPets();
      // 过滤掉自己的宠物
      const others = (response.data.pets || []).filter((p: any) => p.user_id !== user?.id);
      setOpponents(others);
    } catch (error) {
      console.error('加载对手失败:', error);
    }
  };

  const loadHistory = async () => {
    if (!user) return;
    try {
      const response = await battleAPI.getBattleHistory();
      setHistory(response.data.battles || []);
    } catch (error) {
      console.error('加载战斗记录失败:', error);
    }
  };

  const handleBattle = async (opponentId: number) => {
    if (!user) {
      message.warning('你需要先登录才能进行战斗！');
      return;
    }
    if (!pet) {
      message.warning('你需要先拥有一只宠物才能战斗！');
      return;
    }

    setLoading(true);
    try {
      const res = await battleAPI.startBattle({ opponent_pet_id: opponentId });
      const { winner, rewardExp, rewardGold, battleLog, myWinChance } = res.data;

      setBattleResult({
        winner,
        rewardExp,
        rewardGold,
        battleLog,
        myWinChance
      });
      setBattleModalVisible(true);

      if (winner === '我') {
        message.success(`🎉 战斗胜利！获得了 ${rewardExp} 经验 和 ${rewardGold} 金币`);
      } else {
        message.error('💥 战斗失败！再接再厉！');
      }

      loadHistory();
    } catch (error: any) {
      message.error(error.response?.data?.error || '战斗发起失败');
    } finally {
      setLoading(false);
    }
  };

  const tabItems: TabsProps['items'] = [
    {
      key: 'opponents',
      label: '寻找对手',
      children: (
        <Row gutter={[16, 16]}>
          {opponents.map((opponent: any) => (
            <Col xs={24} sm={12} md={8} lg={6} key={opponent.id}>
              <Card 
                hoverable
                style={{ borderRadius: '12px', overflow: 'hidden' }}
                styles={{ body: { padding: '16px' } }}
                cover={
                  <div style={{ height: 160, display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f5f7fa', padding: '20px' }}>
                    {(() => {
                      let imageUrl = opponent.image_urls;
                      try {
                        const urls = typeof opponent.image_urls === 'string' ? JSON.parse(opponent.image_urls) : opponent.image_urls;
                        imageUrl = urls[opponent.growth_stage] || urls['成年期'] || Object.values(urls)[0] || '';
                      } catch (e) {}
                      
                      if (!imageUrl) return <span style={{ fontSize: '64px' }}>🐾</span>;
                      
                      if (imageUrl.startsWith('http') || imageUrl.startsWith('/')) {
                        return <img alt={opponent.name} src={imageUrl} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />;
                      }
                      
                      return <span style={{ fontSize: '64px' }}>{imageUrl}</span>;
                    })()}
                  </div>
                }
                actions={[
                  <Button 
                    type="primary" 
                    danger 
                    icon={<FireOutlined />} 
                    onClick={() => handleBattle(opponent.id)}
                    loading={loading}
                    block
                    style={{ borderRadius: 0 }}
                  >
                    发起挑战
                  </Button>
                ]}
              >
                <Card.Meta 
                  title={opponent.name}
                  description={`${opponent.owner_name}的宠物`}
                />
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
                  <Statistic title="等级" value={opponent.level} valueStyle={{ fontSize: 16 }} />
                  <Statistic title="战斗力" value={opponent.attack + opponent.defense + opponent.speed} valueStyle={{ fontSize: 16, color: '#cf1322' }} prefix={<ThunderboltOutlined />} />
                </div>
              </Card>
            </Col>
          ))}
          {opponents.length === 0 && (
            <div style={{ width: '100%', textAlign: 'center', padding: '40px', color: '#999' }}>
              目前没有可挑战的对手
            </div>
          )}
        </Row>
      )
    },
    {
      key: 'history',
      label: '战斗记录',
      children: (
        !user ? (
          <Card style={{ borderRadius: '12px', textAlign: 'center', padding: '40px' }}>
            <h3 style={{ color: '#999', marginBottom: 20 }}>未登录无法查看战斗记录</h3>
            <Button type="primary" onClick={() => window.location.href = '/login'}>前往登录</Button>
          </Card>
        ) : (
          <Card style={{ borderRadius: '12px' }}>
            <List
              itemLayout="horizontal"
              dataSource={history}
              renderItem={(item: any) => {
                const isWinner = item.winner_id === pet?.id;
                const opponentName = item.pet1_id === pet?.id ? item.pet2_name : item.pet1_name;
                
                return (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <Avatar 
                          size={48} 
                          style={{ backgroundColor: isWinner ? '#f6ffed' : '#fff1f0', color: isWinner ? '#52c41a' : '#f5222d', fontSize: 24 }}
                        >
                          {isWinner ? '🏆' : '💀'}
                        </Avatar>
                      }
                      title={
                        <span style={{ fontSize: 16 }}>
                          挑战 <span style={{ fontWeight: 'bold' }}>{opponentName}</span>
                          <Tag color={isWinner ? 'success' : 'error'} style={{ marginLeft: 12 }}>
                            {isWinner ? '胜利' : '失败'}
                          </Tag>
                        </span>
                      }
                      description={`战斗时间: ${dayjs(item.battle_date).format('YYYY-MM-DD HH:mm:ss')}`}
                    />
                    {isWinner && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: '#faad14', fontWeight: 'bold' }}>+{item.reward_exp} 经验</div>
                        <div style={{ color: '#d4b106' }}>+{item.reward_gold} 金币</div>
                      </div>
                    )}
                  </List.Item>
                );
              }}
            />
          </Card>
        )
      )
    }
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, gap: 12 }}>
        <TrophyOutlined style={{ fontSize: 24, color: '#faad14' }} />
        <h2 style={{ margin: 0 }}>竞技场</h2>
      </div>

      <Tabs defaultActiveKey="opponents" items={tabItems} />

      <Modal
        title="战斗结果"
        open={battleModalVisible}
        onCancel={() => setBattleModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setBattleModalVisible(false)}>
            确定
          </Button>
        ]}
        width={600}
      >
        {battleResult && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>
                {battleResult.winner === '我' ? '🏆' : '💀'}
              </div>
              <h2 style={{ fontSize: 28, marginBottom: 8 }}>
                {battleResult.winner === '我' ? '恭喜获胜！' : '对战失败'}
              </h2>
              <div style={{ color: '#999' }}>
                胜率预测: {battleResult.myWinChance}%
              </div>
            </div>

            {battleResult.battleLog && battleResult.battleLog.rounds && (
              <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                <h4 style={{ marginBottom: 12 }}>战斗回放</h4>
                {battleResult.battleLog.rounds.map((round: any, idx: number) => (
                  <div key={idx} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: idx < battleResult.battleLog.rounds.length - 1 ? '1px solid #ddd' : 'none' }}>
                    <div style={{ fontWeight: 'bold', color: '#667eea', marginBottom: 4 }}>第 {round.round} 回合</div>
                    <div style={{ fontSize: 13 }}>
                      <div>你的宠物: -{round.myDamage} HP ({round.myAction})</div>
                      <div>对手宠物: -{round.opponentDamage} HP ({round.opponentAction})</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {battleResult.winner === '我' && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 48 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, color: '#52c41a', fontWeight: 'bold' }}>+{battleResult.rewardExp}</div>
                  <div style={{ color: '#999' }}>经验</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, color: '#faad14', fontWeight: 'bold' }}>+{battleResult.rewardGold}</div>
                  <div style={{ color: '#999' }}>金币</div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Battle;