import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Progress, Button, message, Input, Modal, Form, Select, Tag, Badge, Divider, Alert } from 'antd';
import {
  ThunderboltOutlined,
  RocketOutlined,
  HeartOutlined,
  SmileOutlined,
  CoffeeOutlined,
  EditOutlined,
  StarOutlined,
  RetweetOutlined,
  RiseOutlined,
  MedicineBoxOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { petAPI, equipmentAPI, petExtendedAPI, itemAPI } from '../utils/api';
import { usePetStore } from '../store/authStore';
import { EquipmentPanel } from './EquipmentPanel';

const { Meta } = Card;

interface PetDisplayProps {
  pet: any;
  onNavigate?: (menu: string) => void;
}

const PetDisplay: React.FC<PetDisplayProps> = ({ pet, onNavigate }) => {
  const { setPet } = usePetStore();
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(pet?.name || '');
  const [equippedItems, setEquippedItems] = useState<any[]>([]);
  const [reviveModalVisible, setReviveModalVisible] = useState(false);
  const [rebirthModalVisible, setRebirthModalVisible] = useState(false);
  const [skillModalVisible, setSkillModalVisible] = useState(false);
  const [mySkills, setMySkills] = useState<any[]>([]);
  const [allSkills, setAllSkills] = useState<any[]>([]);
  const [myItems, setMyItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
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

  const isPetUnconscious = pet?.status === 'unconscious';

  const handleOpenReviveModal = async () => {
    try {
      const res = await itemAPI.getMyItems();
      setMyItems(res.data.items || []);
      setReviveModalVisible(true);
    } catch (error) {
      message.error('加载背包失败');
    }
  };

  const handleRevive = async (values: { item_id?: number }) => {
    try {
      setLoading(true);
      await petExtendedAPI.revivePet(values);
      message.success('复活成功！宠物已恢复');
      setReviveModalVisible(false);
      const response = await petAPI.getMyPet();
      setPet(response.data.pet);
    } catch (error: any) {
      message.error(error.response?.data?.error || '复活失败');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenRebirthModal = async () => {
    try {
      const res = await itemAPI.getMyItems();
      setMyItems(res.data.items || []);
      setRebirthModalVisible(true);
    } catch (error) {
      message.error('加载背包失败');
    }
  };

  const handleRebirth = async (values: { item_id: number }) => {
    try {
      setLoading(true);
      const res = await petExtendedAPI.rebirthPet(values);
      message.success(res.data.message || '转生成功！');
      setRebirthModalVisible(false);
      const response = await petAPI.getMyPet();
      setPet(response.data.pet);
    } catch (error: any) {
      message.error(error.response?.data?.error || '转生失败');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSkillModal = async () => {
    try {
      setLoading(true);
      const [skillsRes, allSkillsRes] = await Promise.all([
        petExtendedAPI.getMySkills(),
        petExtendedAPI.getAllSkills()
      ]);
      setMySkills(skillsRes.data.skills || []);
      setAllSkills(allSkillsRes.data.skills || []);
      setSkillModalVisible(true);
    } catch (error: any) {
      message.error(error.response?.data?.error || '加载技能失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLearnSkill = async (skillId: number) => {
    try {
      await petExtendedAPI.learnSkill({ skill_id: skillId });
      message.success('学习技能成功！');
      handleOpenSkillModal();
      const response = await petAPI.getMyPet();
      setPet(response.data.pet);
    } catch (error: any) {
      message.error(error.response?.data?.error || '学习技能失败');
    }
  };

  const handleForgetSkill = async (skillId: number) => {
    try {
      await petExtendedAPI.forgetSkill({ skill_id: skillId });
      message.success('遗忘技能成功！');
      handleOpenSkillModal();
      const response = await petAPI.getMyPet();
      setPet(response.data.pet);
    } catch (error: any) {
      message.error(error.response?.data?.error || '遗忘技能失败');
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
              isPetUnconscious ? (
                <Button key="revive" type="primary" danger icon={<MedicineBoxOutlined />} onClick={handleOpenReviveModal}>复活宠物</Button>
              ) : (
                <>
                  <Button key="feed" type="primary" onClick={() => onNavigate?.('shop')}>喂食</Button>
                  <Button key="skill" icon={<StarOutlined />} onClick={handleOpenSkillModal}>技能</Button>
                  <Button key="rebirth" icon={<RetweetOutlined />} onClick={handleOpenRebirthModal}>转生</Button>
                </>
              )
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
            {/* 状态异常警告 */}
            {(pet.hunger < 30 || pet.mood < 30) && (
              <Alert
                type="warning"
                message={
                  <span>
                    <WarningOutlined style={{ marginRight: 8 }} />
                    宠物状态异常！
                  </span>
                }
                description={
                  <div>
                    {pet.hunger < 30 && <div>• 饱腹度过低 ({pet.hunger}/100)，请尽快喂食</div>}
                    {pet.mood < 30 && <div>• 心情值过低 ({pet.mood}/100)，请多陪伴宠物</div>}
                    <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                      状态异常会影响战斗经验和属性成长
                    </div>
                  </div>
                }
                showIcon={false}
                style={{ marginBottom: 16, border: '1px solid #faad14' }}
              />
            )}
            
            {isPetUnconscious && (
              <div style={{ background: '#fff1f0', padding: 12, borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>
                <Badge status="error" text={<span style={{ color: '#f5222d', fontWeight: 'bold' }}>宠物处于濒死状态，需要复活！</span>} />
              </div>
            )}
            {pet.rebirth_count > 0 && (
              <div style={{ background: '#f0f5ff', padding: 8, borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>
                <Tag color="blue" icon={<RiseOutlined />}>已转生 {pet.rebirth_count} 次</Tag>
              </div>
            )}
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
                  <HeartOutlined style={{ fontSize: 24, color: pet.health <= 20 ? '#f5222d' : '#eb2f96' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.health}/100
                  </div>
                  <Progress percent={pet.health} size="small" showInfo={false} strokeColor={pet.health <= 20 ? '#f5222d' : '#eb2f96'} style={{ marginTop: 4 }} />
                  <div style={{ color: '#999', fontSize: 12 }}>健康值</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ textAlign: 'center', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                  <SmileOutlined style={{ fontSize: 24, color: pet.mood < 30 ? '#f5222d' : '#faad14' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.mood}/100
                  </div>
                  <Progress percent={pet.mood} size="small" showInfo={false} strokeColor={pet.mood < 30 ? '#f5222d' : '#faad14'} style={{ marginTop: 4 }} />
                  <div style={{ color: '#999', fontSize: 12 }}>心情值</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ textAlign: 'center', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                  <CoffeeOutlined style={{ fontSize: 24, color: pet.stamina < 20 ? '#f5222d' : '#722ed1' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.stamina}/100
                  </div>
                  <Progress percent={pet.stamina} size="small" showInfo={false} strokeColor={pet.stamina < 20 ? '#f5222d' : '#722ed1'} style={{ marginTop: 4 }} />
                  <div style={{ color: '#999', fontSize: 12 }}>体力值</div>
                </div>
              </Col>
              <Col span={12}>
                <div style={{ textAlign: 'center', padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                  <ThunderboltOutlined style={{ fontSize: 24, color: pet.hunger < 30 ? '#f5222d' : '#1890ff' }} />
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold' }}>
                    {pet.hunger}/100
                  </div>
                  <Progress percent={pet.hunger} size="small" showInfo={false} strokeColor={pet.hunger < 30 ? '#f5222d' : '#1890ff'} style={{ marginTop: 4 }} />
                  <div style={{ color: '#999', fontSize: 12 }}>饱腹度</div>
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

      <Modal
        title="复活宠物"
        open={reviveModalVisible}
        onOk={() => form.submit()}
        onCancel={() => setReviveModalVisible(false)}
        confirmLoading={loading}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleRevive}>
          <p style={{ marginBottom: 16 }}>请选择复活道具（可选，不选则使用金币复活）</p>
          <Form.Item name="item_id" label="复活道具">
            <Select placeholder="选择复活道具（不选则消耗100金币）" allowClear>
              {myItems.filter(item => item.effect_type === 'revive').map(item => (
                <Select.Option key={item.item_id} value={item.item_id}>
                  {item.name} (x{item.quantity})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="宠物转生"
        open={rebirthModalVisible}
        onOk={() => form.submit()}
        onCancel={() => setRebirthModalVisible(false)}
        confirmLoading={loading}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleRebirth}>
          <p style={{ marginBottom: 16 }}>转生需要消耗一个「转生之证」，转生后宠物将重置为1级，但保留部分属性加成。</p>
          <Form.Item
            name="item_id"
            label="转生道具"
            rules={[{ required: true, message: '请选择转生道具' }]}
          >
            <Select placeholder="请选择转生道具">
              {myItems.filter(item => item.effect_type === 'rebirth').map(item => (
                <Select.Option key={item.item_id} value={item.item_id}>
                  {item.name} (x{item.quantity})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="宠物技能"
        open={skillModalVisible}
        onCancel={() => setSkillModalVisible(false)}
        footer={null}
        width={700}
      >
        <Divider>已学会的技能</Divider>
        {mySkills.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {mySkills.map(skill => (
              <Tag
                key={skill.id}
                color="blue"
                closable
                onClose={() => handleForgetSkill(skill.id)}
                style={{ padding: '4px 12px', fontSize: 14 }}
              >
                {skill.name} ({skill.element_type})
              </Tag>
            ))}
          </div>
        ) : (
          <p style={{ color: '#999', marginBottom: 24 }}>还没有学会任何技能</p>
        )}

        <Divider>可学习的技能</Divider>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {allSkills.filter(s => !mySkills.find(ms => ms.id === s.id)).map(skill => (
            <Tag
              key={skill.id}
              color="green"
              style={{ padding: '4px 12px', fontSize: 14, cursor: 'pointer' }}
              onClick={() => handleLearnSkill(skill.id)}
            >
              + {skill.name} ({skill.element_type})
            </Tag>
          ))}
        </div>
      </Modal>
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
