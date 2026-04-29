import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Button, List, Tag, Badge, message, Tooltip } from 'antd';
import { SkinOutlined, ArrowUpOutlined, SafetyCertificateOutlined, ThunderboltOutlined, HeartOutlined, RocketOutlined } from '@ant-design/icons';
import { equipmentAPI } from '../utils/api';

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

interface EquipmentPanelProps {
  onEquipChange?: () => void;
}

const slotNames: Record<string, string> = {
  'weapon': '手持/武器',
  'armor': '身躯/衣服',
  'helmet': '头部/帽子',
  'accessory': '配饰/挂件'
};

const slotColors: Record<string, string> = {
  'weapon': '#ff4d4f',
  'armor': '#1890ff',
  'helmet': '#faad14',
  'accessory': '#722ed1'
};

export const EquipmentPanel: React.FC<EquipmentPanelProps> = ({ onEquipChange }) => {
  const isMobile = useMobile();
  const [equipments, setEquipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [setBonus, setSetBonus] = useState<any>(null);

  const loadEquipments = async () => {
    setLoading(true);
    try {
      const res = await equipmentAPI.getMyEquipment();
      setEquipments(res.data.equipment || []);
      if (res.data.bonus) {
        setSetBonus(res.data.bonus);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEquipments();
  }, []);

  const handleEquip = async (user_equip_id: number) => {
    try {
      const res = await equipmentAPI.equipPart({ user_equip_id });
      message.success(res.data.message || '装备更换成功！');
      loadEquipments();
      if (onEquipChange) onEquipChange();
    } catch (e: any) {
      message.error(e.response?.data?.error || '更换失败');
    }
  };

  const handleUpgrade = async (user_equip_id: number) => {
    try {
      await equipmentAPI.upgradePart({ user_equip_id });
      message.success('部件升级成功！');
      loadEquipments();
      if (onEquipChange) onEquipChange();
    } catch (e: any) {
      message.error(e.response?.data?.error || '升级失败');
    }
  };

  const renderStats = (statsJson: string) => {
    try {
      const stats = JSON.parse(statsJson);
      return Object.keys(stats).map(key => {
        let name = key;
        if (key === 'attack') name = '攻击力';
        if (key === 'defense') name = '防御力';
        if (key === 'speed') name = '速度';
        if (key === 'crit_rate') name = '暴击率';
        return <Tag color="orange" key={key}>{name} +{stats[key]}</Tag>;
      });
    } catch {
      return null;
    }
  };

  // 分组装备
  const equippedParts = equipments.filter(e => e.equipped);
  const inventoryParts = equipments.filter(e => !e.equipped);

  return (
    <Card 
      title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SkinOutlined style={{ color: '#1890ff' }} /> 宠物装扮与装备</div>} 
      style={{ marginTop: 24, borderRadius: 12 }}
    >
      <h3 style={{ marginBottom: 16, color: '#555' }}>当前穿戴</h3>
      <Row gutter={[16, 16]}>
        {['helmet', 'armor', 'weapon', 'accessory'].map(slot => {
          const equipped = equippedParts.find(e => e.slot === slot);
          return (
            <Col xs={12} sm={12} md={6} key={slot}>
              <Card
                size="small"
                style={{
                  height: '100%',
                  background: equipped ? '#f0f5ff' : '#fafafa',
                  borderColor: equipped ? slotColors[slot] : '#f0f0f0',
                  borderWidth: equipped ? 2 : 1
                }}
                styles={{ header: { borderBottom: 'none', padding: '0 12px' } }}
                title={<Tag color={slotColors[slot]} style={{ margin: 0, marginTop: 12 }}>{slotNames[slot]}</Tag>}
              >
                {equipped ? (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                      {equipped.image_url?.startsWith('http') || equipped.image_url?.startsWith('/images/') ? (
                        <img
                          src={equipped.image_url}
                          alt={equipped.name}
                          style={{ width: 64, height: 64, objectFit: 'contain', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))', borderRadius: 8 }}
                        />
                      ) : (
                        <div style={{ fontSize: 40, margin: '10px 0', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}>
                          {equipped.image_url || '✨'}
                        </div>
                      )}
                    </div>
                    <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 14 }}>
                      {equipped.name} <Badge count={`Lv.${equipped.level}`} style={{ backgroundColor: '#52c41a' }} />
                      {equipped.set_name && <Tag color="purple" style={{ marginLeft: 4 }}>{equipped.set_name}</Tag>}
                    </div>
                    <div style={{ marginBottom: 12, minHeight: 48, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
                      {renderStats(equipped.stats_bonus)}
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                      <Button
                        size="small"
                        type="default"
                        danger
                        onClick={() => handleEquip(equipped.user_equip_id)}
                      >
                        卸下
                      </Button>
                      <Button 
                        size="small" 
                        type="primary" 
                        icon={<ArrowUpOutlined />} 
                        onClick={() => handleUpgrade(equipped.user_equip_id)}
                        style={{ background: '#52c41a', borderColor: '#52c41a' }}
                      >
                        升级
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: '#bfbfbf', textAlign: 'center', padding: '40px 0' }}>
                    <SafetyCertificateOutlined style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }} />
                    <div>未穿戴</div>
                  </div>
                )}
              </Card>
            </Col>
          );
        })}
      </Row>

      {setBonus && (setBonus.set?.attack > 0 || setBonus.set?.defense > 0 || setBonus.set?.speed > 0) && (
        <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 16, borderRadius: 12, marginTop: 24, color: '#fff' }}>
          <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>套装效果</span>
          </div>
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={8}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <ThunderboltOutlined /> <span>攻击</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>
                  +{setBonus.set.attack}
                </div>
              </div>
            </Col>
            <Col xs={12} sm={8}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <HeartOutlined /> <span>防御</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>
                  +{setBonus.set.defense}
                </div>
              </div>
            </Col>
            <Col xs={12} sm={8}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <RocketOutlined /> <span>速度</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 'bold', marginTop: 4 }}>
                  +{setBonus.set.speed}
                </div>
              </div>
            </Col>
          </Row>
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.9 }}>
            集齐套装装备可激活额外属性加成
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 32, marginBottom: 16, color: '#555' }}>我的衣橱</h3>
      <List
        loading={loading}
        grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4 }}
        dataSource={inventoryParts}
        renderItem={item => (
          <List.Item>
            <Card 
              size="small" 
              hoverable
              style={{ borderRadius: 8 }}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 8, width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.image_url?.startsWith('http') || item.image_url?.startsWith('/images/') ? (
                    <img 
                      src={item.image_url} 
                      alt={item.name} 
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                    />
                  ) : (
                    <span style={{ fontSize: 36 }}>{item.image_url || '✨'}</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                    <Badge count={`Lv.${item.level}`} style={{ backgroundColor: '#1890ff' }} />
                  </div>
                  <Tag color={slotColors[item.slot]} style={{ marginTop: 4, marginBottom: 8 }}>{slotNames[item.slot]}</Tag>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                    {renderStats(item.stats_bonus)}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="small" type="primary" onClick={() => handleEquip(item.user_equip_id)} style={{ flex: 1 }}>
                      穿戴
                    </Button>
                    <Tooltip title="消耗金币升级该装备的属性">
                      <Button size="small" icon={<ArrowUpOutlined />} onClick={() => handleUpgrade(item.user_equip_id)} />
                    </Tooltip>
                  </div>
                </div>
              </div>
            </Card>
          </List.Item>
        )}
      />
    </Card>
  );
};
