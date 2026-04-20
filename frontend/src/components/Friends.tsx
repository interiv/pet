import React, { useEffect, useState } from 'react';
import { Card, Button, Input, List, Avatar, message, Modal, Form, Spin, Row, Col, Statistic, Popconfirm, Select, Tabs, Badge, Empty } from 'antd';
import { UserAddOutlined, TeamOutlined, HeartFilled, DeleteOutlined, GiftOutlined, FireOutlined, EyeOutlined, SearchOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { friendAPI, petAPI, itemAPI } from '../utils/api';

import { useAuthStore, usePetStore } from '../store/authStore';

const Friends: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const { pet } = usePetStore();
  const [friends, setFriends] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [selectedPet, setSelectedPet] = useState<any>(null);
  const [loadingPetDetail, setLoadingPetDetail] = useState(false);
  const [petEquipments, setPetEquipments] = useState<any[]>([]);
  const [petBonus, setPetBonus] = useState<any>(null);
  const [myItems, setMyItems] = useState<any[]>([]);
  const [giftModalVisible, setGiftModalVisible] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<any>(null);
  const [giftForm] = Form.useForm();
  const [battleResult, setBattleResult] = useState<any>(null);
  const [battleModalVisible, setBattleModalVisible] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      loadFriends();
      loadPendingRequests();
    }
  }, [isAuthenticated]);

  const loadFriends = async () => {
    if (!isAuthenticated) return;
    try {
      setLoading(true);
      const res = await friendAPI.getFriends();
      setFriends(res.data.friends || []);
    } catch (error) {
      console.error('加载好友失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPendingRequests = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await friendAPI.getPendingRequests();
      setPendingRequests(res.data.requests || []);
    } catch (error) {
      console.error('加载好友请求失败:', error);
    }
  };

  const handleAddFriend = async (values: any) => {
    try {
      setLoading(true);
      await friendAPI.addFriend({ friend_username: values.username });
      message.success('好友添加成功！');
      setIsModalVisible(false);
      form.resetFields();
      loadFriends();
    } catch (error: any) {
      message.error(error.response?.data?.error || '添加好友失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchFriends = async (keyword: string) => {
    setSearchKeyword(keyword);
    if (!keyword || keyword.trim().length < 1) {
      setSearchResults([]);
      return;
    }
    try {
      setSearchLoading(true);
      const res = await friendAPI.searchFriends(keyword.trim());
      setSearchResults(res.data.users || []);
    } catch (e) {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAddFromSearch = async (targetUser: any) => {
    try {
      setLoading(true);
      const res = await friendAPI.addFriend({ friend_username: targetUser.username });
      message.success(res.data.message || `已发送好友请求给 ${targetUser.username}`);
      setIsModalVisible(false);
      setSearchKeyword('');
      setSearchResults([]);
      form.resetFields();
      loadPendingRequests(); // 刷新待处理请求
    } catch (error: any) {
      message.error(error.response?.data?.error || '添加好友失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptRequest = async (requestId: number) => {
    try {
      setLoading(true);
      await friendAPI.acceptRequest({ request_id: requestId });
      message.success('已接受好友请求');
      loadFriends();
      loadPendingRequests();
    } catch (error: any) {
      message.error(error.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRejectRequest = async (requestId: number) => {
    try {
      setLoading(true);
      await friendAPI.rejectRequest({ request_id: requestId });
      message.success('已拒绝好友请求');
      loadPendingRequests();
    } catch (error: any) {
      message.error(error.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const handleViewFriendPet = async (friend: any) => {
    try {
      setLoadingPetDetail(true);
      setPetModalVisible(true);
      
      // 使用 friend.id 而不是 friend.friend_id
      const response = await petAPI.getUserPet(friend.id);
      setSelectedPet(response.data.pet);
      setPetEquipments(response.data.equipments || []);
      setPetBonus(response.data.bonus || null);
    } catch (error) {
      console.error('加载宠物详情失败:', error);
      message.error('加载宠物详情失败');
    } finally {
      setLoadingPetDetail(false);
    }
  };

  const handleOpenGiftModal = async (friend: any) => {
    setSelectedFriend(friend);
    try {
      const res = await itemAPI.getMyItems();
      setMyItems(res.data.items || []);
      setGiftModalVisible(true);
    } catch (error) {
      message.error('加载背包失败');
    }
  };

  const handleGift = async (values: { item_id: number }) => {
    if (!selectedFriend) return;
    try {
      await friendAPI.giftFriend({ friend_id: selectedFriend.friend_id, item_id: values.item_id });
      message.success('送礼成功！亲密度+' + (myItems.find(i => i.item_id === values.item_id)?.effect_value || 10));
      setGiftModalVisible(false);
      giftForm.resetFields();
      loadFriends();
    } catch (error: any) {
      message.error(error.response?.data?.error || '送礼失败');
    }
  };

  const handleFriendBattle = async (friend: any) => {
    if (!pet) {
      message.warning('你需要先拥有一只宠物才能对战！');
      return;
    }
    try {
      setLoading(true);
      const res = await friendAPI.friendBattle({ friend_id: friend.friend_id });
      const { winner, rewardExp, rewardGold } = res.data;
      setBattleResult({ winner, rewardExp, rewardGold, opponentName: friend.username });
      setBattleModalVisible(true);
      loadFriends();
    } catch (error: any) {
      message.error(error.response?.data?.error || '对战失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFriend = async (friendId: number) => {
    try {
      await friendAPI.removeFriend({ friend_id: friendId });
      message.success('删除成功');
      loadFriends();
    } catch (error: any) {
      message.error(error.response?.data?.error || '删除失败');
    }
  };

  if (!isAuthenticated) {
    return (
      <Card style={{ borderRadius: '12px', textAlign: 'center', padding: '40px' }}>
        <h3 style={{ color: '#999', marginBottom: 20 }}>未登录无法查看好友信息</h3>
        <Button type="primary" onClick={() => window.location.href = '/login'}>前往登录</Button>
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TeamOutlined style={{ fontSize: 24, color: '#1890ff' }} />
          <h2 style={{ margin: 0 }}>我的好友</h2>
        </div>
        <Button 
          type="primary" 
          icon={<UserAddOutlined />} 
          onClick={() => setIsModalVisible(true)}
        >
          添加好友
        </Button>
      </div>

      <Tabs
        items={[
          {
            key: 'friends',
            label: (
              <span>
                好友列表
                {friends.length > 0 && <Badge count={friends.length} style={{ marginLeft: 8 }} />}
              </span>
            ),
            children: (
              <Card style={{ borderRadius: '12px' }}>
                <List
                  itemLayout="horizontal"
                  dataSource={friends}
                  loading={loading}
                  renderItem={(item: any) => (
                    <List.Item
                      actions={[
                        <Button type="link" icon={<EyeOutlined />} onClick={() => handleViewFriendPet(item)}>访问</Button>,
                        <Button type="link" icon={<GiftOutlined />} onClick={() => handleOpenGiftModal(item)}>送礼</Button>,
                        <Button type="link" icon={<FireOutlined />} onClick={() => handleFriendBattle(item)}>对战</Button>,
                        <Popconfirm
                          title="确定要删除该好友吗？"
                          onConfirm={() => handleRemoveFriend(item.id)}
                          okText="确定"
                          cancelText="取消"
                        >
                          <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                        </Popconfirm>
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<Avatar src={item.avatar} style={{ backgroundColor: '#1890ff' }}>{item.username[0]}</Avatar>}
                        title={<span style={{ fontSize: 16, fontWeight: 'bold' }}>{item.username}</span>}
                        description={
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <HeartFilled style={{ color: '#eb2f96' }} /> 
                            <span>亲密度: {item.friendship_level || 0}</span>
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
                {friends.length === 0 && !loading && (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                    你还没有添加任何好友哦~
                  </div>
                )}
              </Card>
            )
          },
          {
            key: 'requests',
            label: (
              <span>
                待处理请求
                {pendingRequests.length > 0 && <Badge count={pendingRequests.length} style={{ marginLeft: 8 }} />}
              </span>
            ),
            children: (
              <Card style={{ borderRadius: '12px' }}>
                <List
                  itemLayout="horizontal"
                  dataSource={pendingRequests}
                  loading={loading}
                  renderItem={(request: any) => (
                    <List.Item
                      actions={[
                        <Button 
                          type="primary" 
                          size="small" 
                          icon={<CheckOutlined />}
                          onClick={() => handleAcceptRequest(request.id)}
                        >
                          接受
                        </Button>,
                        <Button 
                          danger 
                          size="small" 
                          icon={<CloseOutlined />}
                          onClick={() => handleRejectRequest(request.id)}
                        >
                          拒绝
                        </Button>
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<Avatar src={request.avatar} style={{ backgroundColor: '#1890ff' }}>{request.username[0]}</Avatar>}
                        title={<span style={{ fontSize: 16, fontWeight: 'bold' }}>{request.username}</span>}
                        description={
                          <div style={{ color: '#999', fontSize: 12 }}>
                            {request.role === 'teacher' ? '教师' : '学生'} · 请求时间：{new Date(request.created_at).toLocaleString()}
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
                {pendingRequests.length === 0 && !loading && (
                  <Empty description="暂无待处理的好友请求" />
                )}
              </Card>
            )
          }
        ]}
      />

      <Modal
        title="添加好友"
        open={isModalVisible}
        onCancel={() => { setIsModalVisible(false); setSearchKeyword(''); setSearchResults([]); }}
        footer={null}
        destroyOnHidden
      >
        <Input.Search
          placeholder="输入用户名搜索..."
          value={searchKeyword}
          onChange={(e) => handleSearchFriends(e.target.value)}
          onSearch={handleSearchFriends}
          enterButton={<SearchOutlined />}
          style={{ marginBottom: 12 }}
          allowClear
        />
        <Spin spinning={searchLoading}>
          {searchResults.length > 0 ? (
            <List
              dataSource={searchResults}
              renderItem={(u: any) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleAddFromSearch(u)}
                  actions={[<Button type="link" size="small" icon={<UserAddOutlined />}>添加</Button>]}
                >
                  <List.Item.Meta
                    avatar={<Avatar src={u.avatar}>{u.username?.[0]}</Avatar>}
                    title={u.username}
                    description={`${u.role === 'teacher' ? '教师' : '学生'} · ${u.class_name || ''}`}
                  />
                </List.Item>
              )}
            />
          ) : searchKeyword.trim().length >= 1 && !searchLoading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>未找到匹配的用户</div>
          ) : null}
        </Spin>
      </Modal>

      <Modal
        title={selectedPet ? `${selectedPet.owner_name}的宠物 - ${selectedPet.name}` : '宠物详情'}
        open={petModalVisible}
        onCancel={() => setPetModalVisible(false)}
        footer={null}
        width={900}
      >
        <Spin spinning={loadingPetDetail}>
          {selectedPet && (
            <div>
              <Row gutter={[24, 24]}>
                <Col xs={24} md={8}>
                  <div style={{ 
                    height: 300, 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    background: 'linear-gradient(to bottom, #f5f7fa 0%, #c3cfe2 100%)', 
                    borderRadius: 12,
                    padding: 20
                  }}>
                    <img 
                      alt={selectedPet.name} 
                      src={(() => {
                        try {
                          const urls = typeof selectedPet.image_urls === 'string' ? JSON.parse(selectedPet.image_urls) : selectedPet.image_urls;
                          return urls[selectedPet.growth_stage] || urls['成年期'] || Object.values(urls)[0] || '';
                        } catch (e) {
                          return selectedPet.image_urls;
                        }
                      })()} 
                      style={{ 
                        maxHeight: '100%', 
                        maxWidth: '100%', 
                        objectFit: 'contain', 
                        filter: 'drop-shadow(0 10px 8px rgba(0,0,0,0.2))' 
                      }} 
                    />
                  </div>
                  <div style={{ textAlign: 'center', marginTop: 16 }}>
                    <h3 style={{ margin: 0 }}>{selectedPet.name}</h3>
                    <p style={{ color: '#8c8c8c', margin: '4px 0' }}>
                      {selectedPet.species_name} · {selectedPet.growth_stage}
                    </p>
                  </div>
                </Col>
                <Col xs={24} md={16}>
                  <Row gutter={[16, 16]}>
                    <Col xs={12}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="等级" 
                          value={selectedPet.level} 
                          suffix="级"
                          valueStyle={{ color: '#1890ff', fontSize: 24, fontWeight: 'bold' }}
                        />
                      </Card>
                    </Col>
                    <Col xs={12}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="经验值" 
                          value={selectedPet.exp} 
                          suffix="EXP"
                          valueStyle={{ color: '#52c41a', fontSize: 24, fontWeight: 'bold' }}
                        />
                      </Card>
                    </Col>
                    <Col xs={8}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="攻击力" 
                          value={selectedPet.attack} 
                          valueStyle={{ color: '#ff4d4f', fontSize: 20, fontWeight: 'bold' }}
                        />
                        {petBonus?.attack > 0 && (
                          <div style={{ fontSize: 12, color: '#52c41a', marginTop: 4 }}>+{petBonus.attack} 装备加成</div>
                        )}
                      </Card>
                    </Col>
                    <Col xs={8}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="防御力" 
                          value={selectedPet.defense} 
                          valueStyle={{ color: '#1890ff', fontSize: 20, fontWeight: 'bold' }}
                        />
                        {petBonus?.defense > 0 && (
                          <div style={{ fontSize: 12, color: '#52c41a', marginTop: 4 }}>+{petBonus.defense} 装备加成</div>
                        )}
                      </Card>
                    </Col>
                    <Col xs={8}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="速度" 
                          value={selectedPet.speed} 
                          valueStyle={{ color: '#faad14', fontSize: 20, fontWeight: 'bold' }}
                        />
                        {petBonus?.speed > 0 && (
                          <div style={{ fontSize: 12, color: '#52c41a', marginTop: 4 }}>+{petBonus.speed} 装备加成</div>
                        )}
                      </Card>
                    </Col>
                  </Row>

                  {petEquipments.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <h4 style={{ marginBottom: 12 }}>当前穿戴</h4>
                      <Row gutter={[12, 12]}>
                        {petEquipments.map((eq, idx) => (
                          <Col xs={12} key={idx}>
                            <Card 
                              size="small" 
                              style={{ borderRadius: 8, background: '#fafafa' }}
                            >
                              <div style={{ fontWeight: 'bold' }}>{eq.name}</div>
                              <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                {eq.rarity === 'common' ? '普通' : eq.rarity === 'rare' ? '稀有' : eq.rarity === 'epic' ? '史诗' : eq.rarity} · Lv.{eq.level}
                              </div>
                            </Card>
                          </Col>
                        ))}
                      </Row>
                    </div>
                  )}
                </Col>
              </Row>
            </div>
          )}
        </Spin>
      </Modal>

      <Modal
        title={`向 ${selectedFriend?.username} 送礼`}
        open={giftModalVisible}
        onOk={() => giftForm.submit()}
        onCancel={() => setGiftModalVisible(false)}
        confirmLoading={loading}
        destroyOnHidden
      >
        <Form form={giftForm} layout="vertical" onFinish={handleGift}>
          <Form.Item
            name="item_id"
            label="选择礼物"
            rules={[{ required: true, message: '请选择要赠送的礼物' }]}
          >
            <Select placeholder="选择要赠送的礼物">
              {myItems.map(item => (
                <Select.Option key={item.item_id} value={item.item_id}>
                  {item.name} (x{item.quantity}) - 亲密度+{item.effect_value}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="对战结果"
        open={battleModalVisible}
        onCancel={() => setBattleModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setBattleModalVisible(false)}>
            确定
          </Button>
        ]}
      >
        {battleResult && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              {battleResult.winner === '我' ? '🏆' : '💀'}
            </div>
            <h3 style={{ fontSize: 24, marginBottom: 24 }}>
              {battleResult.winner === '我' ? '恭喜获胜！' : '对战失败'}
            </h3>
            <p style={{ fontSize: 16, color: '#666' }}>
              与 <strong>{battleResult.opponentName}</strong> 的对战
            </p>
            {battleResult.winner === '我' && (
              <div style={{ marginTop: 20 }}>
                <Statistic title="获得经验" value={battleResult.rewardExp} valueStyle={{ color: '#52c41a' }} />
                <Statistic title="获得金币" value={battleResult.rewardGold} valueStyle={{ color: '#faad14' }} />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Friends;