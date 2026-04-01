import React, { useState } from 'react';
import { Card, Row, Col, Progress, Button, message, Input } from 'antd';
import { 
  ThunderboltOutlined, 
  RocketOutlined,
  HeartOutlined,
  SmileOutlined,
  CoffeeOutlined,
  EditOutlined
} from '@ant-design/icons';
import { petAPI, equipmentAPI } from '../utils/api';
import { usePetStore } from '../store/authStore';
import { EquipmentPanel } from './EquipmentPanel';

const { Meta } = Card;

interface PetDisplayProps {
  pet: any;
}

const PetDisplay: React.FC<PetDisplayProps> = ({ pet }) => {
  const { setPet } = usePetStore();
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(pet?.name || '');
  const [equippedItems, setEquippedItems] = useState<any[]>([]);

  React.useEffect(() => {
    loadEquipments();
  }, []);

  const loadEquipments = async () => {
    try {
      const res = await equipmentAPI.getMyEquipment();
      setEquippedItems((res.data.equipment || []).filter((e: any) => e.equipped));
    } catch (e) {
      console.error(e);
    }
  };

  if (!pet) {
    return <div style={{ textAlign: 'center', padding: '50px' }}>宠物数据加载中...</div>;
  }

  const getGrowthStageEmoji = (stage: string) => {
    const emojis: Record<string, string> = {
      '宠物蛋': '🥚',
      '初生期': '🐣',
      '幼年期': '🐾',
      '成长期': '🌱',
      '成年期': '🦅',
      '完全体': '✨',
      '究极体': '🌟'
    };
    return emojis[stage] || '🐾';
  };

  const calculateExpProgress = () => {
    const threshold = Math.floor(100 * Math.pow(pet.level, 1.5));
    return Math.min(100, Math.floor((pet.exp / threshold) * 100));
  };

  const handleUpdateName = async () => {
    try {
      await petAPI.updatePet({ name: newName });
      message.success('改名成功！');
      setEditingName(false);
      const response = await petAPI.getMyPet();
      setPet(response.data.pet);
    } catch (error: any) {
      message.error('改名失败');
    }
  };

  const handleEquipChange = async () => {
    try {
      const response = await petAPI.getMyPet();
      setPet(response.data.pet);
      loadEquipments();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div>
      <Row gutter={[24, 24]}>
        {/* 左侧装备 */}
        <Col xs={24} md={8}>
          <Card title="当前穿戴" size="small" style={{ height: '100%' }}>
            {['helmet', 'armor', 'weapon', 'accessory'].map(slot => {
              const item = equippedItems.find(e => e.slot === slot);
              const slotNameMap: Record<string, string> = {
                'helmet': '头部',
                'armor': '身躯',
                'weapon': '手持',
                'accessory': '配饰'
              };
              return (
                <div key={slot} style={{ marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 8, color: '#666' }}>{slotNameMap[slot]}</div>
                  {item ? (
                    <div>
                      {item.image_url?.startsWith('http') || item.image_url?.startsWith('/images/') ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          style={{ width: 60, height: 60, objectFit: 'contain', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}
                        />
                      ) : (
                        <span style={{ fontSize: 40 }}>{item.image_url || '✨'}</span>
                      )}
                      <div style={{ fontSize: 12, marginTop: 4, color: '#888' }}>{item.name}</div>
                    </div>
                  ) : (
                    <div style={{ color: '#ccc', fontSize: 36 }}>—</div>
                  )}
                </div>
              );
            })}
          </Card>
        </Col>

        {/* 宠物形象展示 */}
        <Col xs={24} md={8}>
          <Card
            hoverable
            cover={
              <div style={{ 
                height: 300, 
                background: 'linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative'
              }}>
                <div style={{ position: 'relative', height: '60%', width: '60%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <img 
                    src={(() => {
                      try {
                        const urls = typeof pet.image_urls === 'string' ? JSON.parse(pet.image_urls) : pet.image_urls;
                        return urls[pet.growth_stage] || urls['成年期'] || Object.values(urls)[0] || '';
                      } catch (e) {
                        return pet.image_urls;
                      }
                    })()} 
                    alt={pet.name} 
                    style={{ 
                      maxHeight: '100%', 
                      maxWidth: '100%', 
                      objectFit: 'contain',
                      filter: 'drop-shadow(0px 10px 10px rgba(0,0,0,0.2))',
                      zIndex: 6,
                      position: 'relative'
                    }} 
                  />
                </div>
                <div style={{ position: 'absolute', top: 10, right: 10, fontSize: '24px' }}>
                  {getGrowthStageEmoji(pet.growth_stage)}
                </div>
              </div>
            }
            actions={[
              <Button key="feed" type="primary">喂食</Button>,
              <Button key="play">玩耍</Button>,
              <Button key="train">训练</Button>,
            ]}
          >
            <Meta
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {editingName ? (
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onBlur={handleUpdateName}
                      onPressEnter={handleUpdateName}
                      style={{ width: 150 }}
                      autoFocus
                    />
                  ) : (
                    <>
                      <span>{pet.name}</span>
                      <EditOutlined 
                        onClick={() => setEditingName(true)}
                        style={{ cursor: 'pointer', color: '#999' }}
                      />
                    </>
                  )}
                </div>
              }
              description={
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: '#666' }}>品种：</span>
                    <span>{pet.species_name}</span>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: '#666' }}>阶段：</span>
                    <span>{pet.growth_stage}</span>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: '#666' }}>属性：</span>
                    <span style={{ 
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: getElementColor(pet.element_type),
                      color: '#fff',
                      fontSize: 12
                    }}>
                      {getElementName(pet.element_type)}
                    </span>
                  </div>
                </div>
              }
            />
          </Card>
        </Col>

        {/* 右侧属性面板 */}
        <Col xs={24} md={8}>
          <Card title="宠物属性">
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#667eea' }}>
                Lv.{pet.level}
              </div>
              <Progress 
                percent={calculateExpProgress()} 
                status="active"
                format={() => `${pet.exp} / ${Math.floor(100 * Math.pow(pet.level, 1.5))} EXP`}
              />
            </div>

            <Row gutter={[16, 16]}>
              <Col span={12}>
                <div style={{ textAlign: 'center', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                  <ThunderboltOutlined style={{ fontSize: 24, color: '#ff4d4f' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.attack}
                  </div>
                  <div style={{ color: '#999', fontSize: 12 }}>攻击力</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ textAlign: 'center', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                  <HeartOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.defense}
                  </div>
                  <div style={{ color: '#999', fontSize: 12 }}>防御力</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ textAlign: 'center', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                  <RocketOutlined style={{ fontSize: 24, color: '#52c41a' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.speed}
                  </div>
                  <div style={{ color: '#999', fontSize: 12 }}>速度</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ textAlign: 'center', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                  <HeartOutlined style={{ fontSize: 24, color: '#eb2f96' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.health}
                  </div>
                  <div style={{ color: '#999', fontSize: 12 }}>健康值</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ textAlign: 'center', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                  <SmileOutlined style={{ fontSize: 24, color: '#faad14' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.mood}
                  </div>
                  <div style={{ color: '#999', fontSize: 12 }}>心情值</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ textAlign: 'center', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                  <CoffeeOutlined style={{ fontSize: 24, color: '#722ed1' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.hunger}
                  </div>
                  <div style={{ color: '#999', fontSize: 12 }}>饥饿度</div>
                </div>
              </Col>
            </Row>

            <div style={{ marginTop: 24, textAlign: 'center', color: '#999' }}>
              <div>战斗统计</div>
              <div style={{ marginTop: 8 }}>
                胜场：<span style={{ color: '#52c41a', fontWeight: 'bold' }}>{pet.win_count}</span>
                {' / '}
                总场次：<span style={{ fontWeight: 'bold' }}>{pet.total_battles}</span>
                {' / '}
                胜率：<span style={{ color: '#1890ff', fontWeight: 'bold' }}>
                  {pet.total_battles > 0 ? ((pet.win_count / pet.total_battles) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      <EquipmentPanel onEquipChange={handleEquipChange} />
    </div>
  );
};

const getElementName = (type: string) => {
  const names: Record<string, string> = {
    'fire': '火',
    'water': '水',
    'grass': '草',
    'light': '光',
    'dark': '暗'
  };
  return names[type] || '普通';
};

const getElementColor = (type: string) => {
  const colors: Record<string, string> = {
    'fire': '#ff4d4f',
    'water': '#1890ff',
    'grass': '#52c41a',
    'light': '#faad14',
    'dark': '#722ed1'
  };
  return colors[type] || '#999';
};

export default PetDisplay;
