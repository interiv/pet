import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Button, Tabs, Badge, Statistic, message, List, Avatar, TabsProps } from 'antd';
import { ShoppingCartOutlined, DollarCircleOutlined, GiftOutlined } from '@ant-design/icons';
import { itemAPI, petAPI } from '../utils/api';
import { useAuthStore, usePetStore } from '../store/authStore';



interface Props {
  defaultTab?: string;
}

const ShopAndBackpack: React.FC<Props> = ({ defaultTab = 'shop' }) => {
  const { user } = useAuthStore();
  const { pet, setPet } = usePetStore();
  
  const [shopItems, setShopItems] = useState<any[]>([]);
  const [myItems, setMyItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    if (user) {
      if (activeTab === 'shop') {
        loadShopItems();
      } else {
        loadMyItems();
      }
    }
  }, [activeTab, user]);

  const loadShopItems = async () => {
    if (!user) return;
    try {
      const res = await itemAPI.getItems();
      setShopItems(res.data.items || []);
    } catch (error) {
      message.error('加载商店失败');
    }
  };

  const loadMyItems = async () => {
    if (!user) return;
    try {
      const res = await itemAPI.getMyItems();
      setMyItems(res.data.items || []);
    } catch (error) {
      message.error('加载背包失败');
    }
  };

  const handleBuy = async (itemId: number, price: number) => {
    if ((user?.gold || 0) < price) {
      message.warning('金币不足！');
      return;
    }
    
    setLoading(true);
    try {
      await itemAPI.buyItem({ item_id: itemId, quantity: 1 });
      message.success('购买成功！');
      // 简单刷新当前金币显示(理想情况应该更新 authStore 里的 user.gold)
    } catch (error: any) {
      message.error(error.response?.data?.error || '购买失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFeed = async (itemId: number) => {
    if (!pet) {
      message.warning('你需要先拥有一只宠物！');
      return;
    }

    setLoading(true);
    try {
      const res = await petAPI.feedPet({ item_id: itemId });
      message.success(res.data.levelUp ? '🎉 恭喜，宠物升级了！' : '投喂成功！');
      
      // 更新宠物状态
      const petRes = await petAPI.getMyPet();
      setPet(petRes.data.pet);
      
      loadMyItems(); // 刷新背包
    } catch (error: any) {
      message.error(error.response?.data?.error || '投喂失败');
    } finally {
      setLoading(false);
    }
  };

  const getEffectColor = (type: string) => {
    switch(type) {
      case 'exp': return '#52c41a';
      case 'hunger': return '#faad14';
      case 'health': return '#f5222d';
      case 'mood': return '#eb2f96';
      case 'attack': return '#f5222d';
      case 'defense': return '#1890ff';
      case 'speed': return '#faad14';
      default: return '#1890ff';
    }
  };

  const getEffectName = (type: string) => {
    switch(type) {
      case 'exp': return '经验';
      case 'hunger': return '饱食度';
      case 'health': return '健康';
      case 'mood': return '心情';
      case 'attack': return '攻击力';
      case 'defense': return '防御力';
      case 'speed': return '速度';
      default: return '属性';
    }
  };

  if (!user) {
    return (
      <Card style={{ borderRadius: '12px', textAlign: 'center', padding: '40px' }}>
        <h3 style={{ color: '#999', marginBottom: 20 }}>未登录无法查看商店与背包</h3>
        <Button type="primary" onClick={() => window.location.href = '/login'}>前往登录</Button>
      </Card>
    );
  }

  const tabItems: TabsProps['items'] = [
    {
      key: 'shop',
      label: <span><ShoppingCartOutlined /> 道具商店</span>,
      children: (
        <Row gutter={[16, 16]}>
          {shopItems.map(item => (
            <Col xs={24} sm={12} md={8} lg={6} key={item.id}>
              <Card 
                hoverable
                style={{ borderRadius: '12px' }}
                actions={[
                  <Button 
                    type="primary" 
                    onClick={() => handleBuy(item.id, item.price)}
                    loading={loading}
                  >
                    购买 ({item.price} 金币)
                  </Button>
                ]}
              >
                <Card.Meta 
                  avatar={
                    <Avatar size={48} style={{ background: '#f0f2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }} src={item.image_url?.startsWith('http') || item.image_url?.startsWith('/') ? item.image_url : undefined}>
                      {(!item.image_url?.startsWith('http') && !item.image_url?.startsWith('/')) ? (item.image_url || '🎁') : null}
                    </Avatar>
                  }
                  title={item.name}
                  description={
                    <div>
                      <div style={{ color: '#888', marginBottom: 8, minHeight: 44 }}>{item.description}</div>
                      <Badge 
                        count={`+${item.effect_value} ${getEffectName(item.effect_type)}`} 
                        style={{ backgroundColor: getEffectColor(item.effect_type) }} 
                      />
                    </div>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )
    },
    {
      key: 'backpack',
      label: <span><GiftOutlined /> 我的背包</span>,
      children: (
        <Card style={{ borderRadius: '12px' }}>
          <List
            itemLayout="horizontal"
            dataSource={myItems}
            renderItem={item => (
              <List.Item
                actions={[
                  <Button 
                    type="primary" 
                    onClick={() => handleFeed(item.item_id)}
                    loading={loading}
                  >
                    {item.effect_type === 'exp' ? '使用' : '投喂'}
                  </Button>
                ]}
              >
                <List.Item.Meta
                    avatar={
                      <Badge count={`x${item.quantity}`} color="#1890ff">
                        <Avatar size={48} style={{ background: '#f0f2f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }} src={item.image_url?.startsWith('http') || item.image_url?.startsWith('/') ? item.image_url : undefined}>
                          {(!item.image_url?.startsWith('http') && !item.image_url?.startsWith('/')) ? (item.image_url || '🎁') : null}
                        </Avatar>
                      </Badge>
                    }
                    title={item.name}
                  description={
                    <div>
                      <span style={{ marginRight: 16 }}>{item.description}</span>
                      <Badge 
                        count={`+${item.effect_value} ${getEffectName(item.effect_type)}`} 
                        style={{ backgroundColor: getEffectColor(item.effect_type) }} 
                      />
                    </div>
                  }
                />
              </List.Item>
            )}
          />
          {myItems.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
              背包空空如也，去商店买点东西吧！
            </div>
          )}
        </Card>
      )
    }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ShoppingCartOutlined style={{ fontSize: 24, color: '#1890ff' }} />
          <h2 style={{ margin: 0 }}>商店与背包</h2>
        </div>
        <Statistic 
          value={user?.gold || 0} 
          prefix={<DollarCircleOutlined style={{ color: '#faad14' }} />} 
          valueStyle={{ color: '#faad14', fontWeight: 'bold' }} 
          suffix="金币"
        />
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </div>
  );
};

export default ShopAndBackpack;