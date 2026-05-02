import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Button, List, Tag, Badge, message, Tooltip, Tabs, Modal, Statistic } from 'antd';
import { SkinOutlined, ArrowUpOutlined, SafetyCertificateOutlined, ThunderboltOutlined, HeartOutlined, RocketOutlined, ShoppingCartOutlined, DollarCircleOutlined, LockOutlined } from '@ant-design/icons';
import { equipmentAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

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

const rarityColors: Record<string, string> = {
  'common': '#8c8c8c',
  'rare': '#1890ff',
  'epic': '#722ed1',
  'legendary': '#fa8c16'
};

const rarityNames: Record<string, string> = {
  'common': '普通',
  'rare': '稀有',
  'epic': '史诗',
  'legendary': '传说'
};

const rarityUpgradeMultiplier: Record<string, number> = {
  'common': 1,
  'rare': 1.5,
  'epic': 2,
  'legendary': 3
};

export const EquipmentPanel: React.FC<EquipmentPanelProps> = ({ onEquipChange }) => {
  const { user, setUser } = useAuthStore();
  const [equipments, setEquipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [setBonus, setSetBonus] = useState<any>(null);
  const [shopItems, setShopItems] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('equipped');

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

  const loadShop = async () => {
    try {
      const res = await equipmentAPI.getShop();
      setShopItems(res.data.equipments || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadEquipments();
  }, []);

  useEffect(() => {
    if (activeTab === 'shop') {
      loadShop();
    }
  }, [activeTab]);

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
      const res = await equipmentAPI.upgradePart({ user_equip_id });
      message.success(res.data.message || '升级成功！');
      loadEquipments();
      if (onEquipChange) onEquipChange();
    } catch (e: any) {
      message.error(e.response?.data?.error || '升级失败');
    }
  };

  const handleBuy = async (equipment_id: number, name: string, price: number) => {
    Modal.confirm({
      title: '购买确认',
      content: `确定要花费 ${price} 金币购买「${name}」吗？`,
      okText: '购买',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await equipmentAPI.buyEquipment({ equipment_id });
          message.success(res.data.message || '购买成功！');
          loadShop();
          loadEquipments();
          const meRes = await (await import('../utils/api')).authAPI.getMe();
          setUser(meRes.data.user);
        } catch (e: any) {
          message.error(e.response?.data?.error || '购买失败');
        }
      }
    });
  };

  const handleSell = async (user_equip_id: number, name: string, price: number, level: number) => {
    const levelMultiplier = 1 + (level - 1) * 0.15;
    const sellPrice = Math.floor(price * 0.4 * levelMultiplier);

    Modal.confirm({
      title: '出售确认',
      content: `确定要出售「${name}」吗？将获得 ${sellPrice} 金币（原价的40%，等级加成已计入）。`,
      okText: '出售',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await equipmentAPI.sellEquipment({ user_equip_id });
          message.success(res.data.message || '出售成功！');
          loadEquipments();
          const meRes = await (await import('../utils/api')).authAPI.getMe();
          setUser(meRes.data.user);
        } catch (e: any) {
          message.error(e.response?.data?.error || '出售失败');
        }
      }
    });
  };

  const renderStats = (statsJson: string, level: number = 1) => {
    try {
      const stats = JSON.parse(statsJson);
      const multiplier = 1 + (level - 1) * 0.2;
      return Object.keys(stats).map(key => {
        let name = key;
        let color = 'orange';
        if (key === 'attack') { name = '攻击力'; color = '#f5222d'; }
        if (key === 'defense') { name = '防御力'; color = '#1890ff'; }
        if (key === 'speed') { name = '速度'; color = '#faad14'; }
        if (key === 'crit_rate') { name = '暴击率'; color = '#722ed1'; }
        const actualValue = Math.floor(stats[key] * multiplier);
        const isNegative = actualValue < 0;
        return (
          <Tag color={isNegative ? 'red' : color} key={key} style={{ margin: 2 }}>
            {name} {isNegative ? '' : '+'}{actualValue}{key === 'crit_rate' ? '%' : ''}
            {level > 1 ? <span style={{ color: '#52c41a', fontSize: 10 }}> (Lv{level})</span> : ''}
          </Tag>
        );
      });
    } catch {
      return null;
    }
  };

  const renderShopStats = (statsJson: string) => {
    try {
      const stats = JSON.parse(statsJson);
      return Object.keys(stats).map(key => {
        let name = key;
        let color = 'orange';
        if (key === 'attack') { name = '攻击力'; color = '#f5222d'; }
        if (key === 'defense') { name = '防御力'; color = '#1890ff'; }
        if (key === 'speed') { name = '速度'; color = '#faad14'; }
        if (key === 'crit_rate') { name = '暴击率'; color = '#722ed1'; }
        const val = stats[key];
        const isNegative = val < 0;
        return (
          <Tag color={isNegative ? 'red' : color} key={key} style={{ margin: 2 }}>
            {name} {isNegative ? '' : '+'}{val}{key === 'crit_rate' ? '%' : ''}
          </Tag>
        );
      });
    } catch {
      return null;
    }
  };

  const getUpgradeCost = (level: number, rarity: string) => {
    return Math.floor(level * 100 * (rarityUpgradeMultiplier[rarity] || 1));
  };

  const getSellPrice = (price: number, level: number) => {
    const levelMultiplier = 1 + (level - 1) * 0.15;
    return Math.floor(price * 0.4 * levelMultiplier);
  };

  const equippedParts = equipments.filter(e => e.equipped);
  const inventoryParts = equipments.filter(e => !e.equipped);

  const shopBySlot = (slot: string) => shopItems.filter(e => e.slot === slot);

  const tabItems = [
    {
      key: 'equipped',
      label: '当前装备',
      children: (
        <>
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
                          <Tag color={rarityColors[equipped.rarity]} style={{ marginLeft: 4, fontSize: 11 }}>{rarityNames[equipped.rarity]}</Tag>
                        </div>
                        <div style={{ marginBottom: 12, minHeight: 48, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
                          {renderStats(equipped.stats_bonus, equipped.level)}
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
                            disabled={equipped.level >= 10}
                          >
                            升级 {equipped.level < 10 ? `(${getUpgradeCost(equipped.level, equipped.rarity)}💰)` : '(满级)'}
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
        </>
      )
    },
    {
      key: 'shop',
      label: <span><ShoppingCartOutlined /> 装备商店</span>,
      children: (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <Statistic
              value={user?.gold || 0}
              prefix={<DollarCircleOutlined style={{ color: '#faad14' }} />}
              valueStyle={{ color: '#faad14', fontWeight: 'bold', fontSize: 18 }}
              suffix="金币"
            />
          </div>
          {['weapon', 'armor', 'helmet', 'accessory'].map(slot => (
            <div key={slot} style={{ marginBottom: 24 }}>
              <h4 style={{ color: slotColors[slot], marginBottom: 12, borderLeft: `3px solid ${slotColors[slot]}`, paddingLeft: 8 }}>
                {slotNames[slot]}
              </h4>
              <Row gutter={[16, 16]}>
                {shopBySlot(slot).map(item => (
                  <Col xs={24} sm={12} md={8} lg={6} key={item.id}>
                    <Card
                      size="small"
                      hoverable
                      style={{
                        borderRadius: 8,
                        opacity: item.level_locked ? 0.6 : 1,
                        borderColor: item.owned ? '#52c41a' : rarityColors[item.rarity],
                        borderWidth: item.owned ? 2 : 1
                      }}
                    >
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{
                          background: '#f5f5f5', borderRadius: 8, padding: 8, width: 56, height: 56,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                        }}>
                          {item.image_url?.startsWith('http') || item.image_url?.startsWith('/images/') ? (
                            <img src={item.image_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          ) : (
                            <span style={{ fontSize: 28 }}>{item.image_url || '✨'}</span>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                            <div style={{ fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                            <Tag color={rarityColors[item.rarity]} style={{ fontSize: 10, lineHeight: '18px', margin: 0 }}>{rarityNames[item.rarity]}</Tag>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 6 }}>
                            {renderShopStats(item.stats_bonus)}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                            <span style={{ color: '#faad14', fontWeight: 'bold', fontSize: 13 }}>{item.price} 💰</span>
                            {item.level_locked ? (
                              <Tag icon={<LockOutlined />} color="default" style={{ fontSize: 11 }}>Lv.{item.required_level}</Tag>
                            ) : item.owned ? (
                              <Tag color="success" style={{ fontSize: 11 }}>已拥有</Tag>
                            ) : (
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => handleBuy(item.id, item.name, item.price)}
                                disabled={(user?.gold || 0) < item.price}
                              >
                                购买
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </Col>
                ))}
              </Row>
            </div>
          ))}
        </>
      )
    },
    {
      key: 'inventory',
      label: '我的衣橱',
      children: (
        <List
          loading={loading}
          grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4 }}
          dataSource={inventoryParts}
          locale={{ emptyText: '衣橱空空如也，去装备商店看看吧！' }}
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
                      <img src={item.image_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <span style={{ fontSize: 36 }}>{item.image_url || '✨'}</span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                      <Badge count={`Lv.${item.level}`} style={{ backgroundColor: '#1890ff' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, marginBottom: 4 }}>
                      <Tag color={slotColors[item.slot]}>{slotNames[item.slot]}</Tag>
                      <Tag color={rarityColors[item.rarity]} style={{ fontSize: 10 }}>{rarityNames[item.rarity]}</Tag>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                      {renderStats(item.stats_bonus, item.level)}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Button size="small" type="primary" onClick={() => handleEquip(item.user_equip_id)} style={{ flex: 1 }}>
                        穿戴
                      </Button>
                      <Tooltip title="消耗金币升级该装备的属性">
                        <Button size="small" icon={<ArrowUpOutlined />} onClick={() => handleUpgrade(item.user_equip_id)} />
                      </Tooltip>
                      <Tooltip title={`出售可获得 ${getSellPrice(item.price, item.level)} 金币`}>
                        <Button size="small" danger icon={<DollarCircleOutlined />} onClick={() => handleSell(item.user_equip_id, item.name, item.price, item.level)} />
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </Card>
            </List.Item>
          )}
        />
      )
    }
  ];

  return (
    <Card
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SkinOutlined style={{ color: '#1890ff' }} /> 宠物装扮与装备
          </div>
          <Statistic
            value={user?.gold || 0}
            prefix={<DollarCircleOutlined style={{ color: '#faad14' }} />}
            valueStyle={{ color: '#faad14', fontWeight: 'bold', fontSize: 16 }}
            suffix="金币"
          />
        </div>
      }
      style={{ marginTop: 24, borderRadius: 12 }}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Card>
  );
};
