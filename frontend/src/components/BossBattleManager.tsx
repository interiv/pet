import React, { useEffect, useState } from 'react';
import {
  Card, Table, Button, Form, Input, InputNumber, Select, Tag, Space, Modal,
  Row, Col, Descriptions, Progress, Popconfirm, Empty, Spin, message,
  Checkbox, Divider, Alert, Statistic, List, Badge,
} from 'antd';
import {
  FireOutlined, PlusOutlined, DeleteOutlined, StopOutlined,
  EyeOutlined, ThunderboltOutlined, TeamOutlined,
  ClockCircleOutlined, SwapOutlined,
} from '@ant-design/icons';
import { bossBattleAPI, equipmentAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const BOSS_ICON_OPTIONS = [
  { label: '👹 鬼怪', value: '👹' },
  { label: '👑 王者', value: '👑' },
  { label: '🐉 巨龙', value: '🐉' },
  { label: '👿 恶魔', value: '👿' },
  { label: '🦹 反派', value: '🦹' },
  { label: '💀 骷髅', value: '💀' },
  { label: '🧌 巨魔', value: '🧌' },
  { label: '🔥 烈焰', value: '🔥' },
  { label: '⚡ 雷霆', value: '⚡' },
  { label: '🎲 随机', value: '' },
];

const BossBattleManager: React.FC = () => {
  const { user } = useAuthStore();
  const [classes, setClasses] = useState<any[]>([]);
  const [headClasses, setHeadClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [currentBoss, setCurrentBoss] = useState<any>(null);
  const [bossList, setBossList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [equipmentList, setEquipmentList] = useState<any[]>([]);
  const [wrongQuestions, setWrongQuestions] = useState<any[]>([]);
  const [questionSource, setQuestionSource] = useState<string>('knowledge');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);
  const [wrongQLoading, setWrongQLoading] = useState(false);

  useEffect(() => {
    const teacherClasses = (user as any)?.teacher_classes || [];
    setClasses(teacherClasses);
    const headCls = teacherClasses.filter((c: any) => c.class_role === 'head_teacher');
    setHeadClasses(headCls);
    if (headCls.length > 0) {
      setSelectedClassId(headCls[0].id);
    }
  }, [user]);

  useEffect(() => {
    if (selectedClassId) {
      loadCurrentBoss();
      loadBossList();
    }
  }, [selectedClassId]);

  const loadCurrentBoss = async () => {
    if (!selectedClassId) return;
    try {
      const res = await bossBattleAPI.getCurrentBoss(selectedClassId);
      setCurrentBoss(res.data.boss);
    } catch (error) {
      console.error('加载BOSS失败:', error);
    }
  };

  const loadBossList = async () => {
    if (!selectedClassId) return;
    setLoading(true);
    try {
      const res = await bossBattleAPI.listBosses(selectedClassId);
      setBossList(res.data.bosses || []);
    } catch (error) {
      console.error('加载BOSS列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadEquipment = async () => {
    try {
      const res = await equipmentAPI.getAll();
      setEquipmentList(res.data.equipments || []);
    } catch (e) {
      console.error('加载装备失败:', e);
    }
  };

  const loadWrongQuestions = async () => {
    if (!selectedClassId) return;
    setWrongQLoading(true);
    try {
      const res = await bossBattleAPI.getWrongQuestions(selectedClassId);
      setWrongQuestions(res.data.wrongQuestions || []);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载错题失败');
    } finally {
      setWrongQLoading(false);
    }
  };

  const handleCreateOpen = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      duration_hours: 24,
      boss_level: 5,
      question_source: 'knowledge',
    });
    setQuestionSource('knowledge');
    setSelectedQuestionIds([]);
    loadEquipment();
    loadWrongQuestions();
    setCreateModalVisible(true);
  };

  const handleCreate = async (values: any) => {
    if (!selectedClassId) {
      message.error('请先选择班级');
      return;
    }
    setCreating(true);
    try {
      const data: any = {
        class_id: selectedClassId,
        boss_name: values.boss_name,
        boss_level: values.boss_level,
        boss_icon: values.boss_icon || undefined,
        boss_description: values.boss_description || undefined,
        knowledge_point: values.knowledge_point || undefined,
        duration_hours: values.duration_hours || 24,
        boss_hp: values.boss_hp || undefined,
        reward_gold: values.reward_gold || undefined,
        reward_exp: values.reward_exp || undefined,
        reward_equipment_id: values.reward_equipment_id || undefined,
        question_source: values.question_source || 'knowledge',
        question_ids: values.question_source === 'selected' ? selectedQuestionIds : undefined,
      };
      await bossBattleAPI.create(data);
      message.success('BOSS创建成功！');
      setCreateModalVisible(false);
      createForm.resetFields();
      loadCurrentBoss();
      loadBossList();
    } catch (error: any) {
      message.error(error.response?.data?.error || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleAutoGenerate = async () => {
    if (!selectedClassId) {
      message.error('请先选择班级');
      return;
    }
    setAutoGenerating(true);
    try {
      const res = await bossBattleAPI.autoGenerate({ class_id: selectedClassId });
      message.success(`BOSS「${res.data.boss_name}」已创建！等级 Lv.${res.data.boss_level}`);
      loadCurrentBoss();
      loadBossList();
    } catch (error: any) {
      message.error(error.response?.data?.error || '自动生成失败');
    } finally {
      setAutoGenerating(false);
    }
  };

  const handleTerminate = async (bossId: number) => {
    try {
      await bossBattleAPI.terminate(bossId);
      message.success('BOSS战已终止');
      loadCurrentBoss();
      loadBossList();
    } catch (error: any) {
      message.error(error.response?.data?.error || '终止失败');
    }
  };

  const handleDelete = async (bossId: number) => {
    try {
      await bossBattleAPI.deleteBoss(bossId);
      message.success('BOSS记录已删除');
      loadBossList();
    } catch (error: any) {
      message.error(error.response?.data?.error || '删除失败');
    }
  };

  const handleViewDetail = async (bossId: number) => {
    try {
      const res = await bossBattleAPI.getDetail(bossId);
      setDetailData(res.data);
      setDetailModalVisible(true);
    } catch (error: any) {
      message.error(error.response?.data?.error || '获取详情失败');
    }
  };

  const selectedClassName = classes.find(c => c.id === selectedClassId)?.name || '';

  const statusConfig: Record<string, { color: string; label: string }> = {
    active: { color: 'red', label: '进行中' },
    defeated: { color: 'green', label: '已击败' },
    expired: { color: 'default', label: '已过期' },
  };

  const bossColumns = [
    {
      title: 'BOSS',
      dataIndex: 'boss_name',
      key: 'boss_name',
      render: (name: string, record: any) => (
        <span>{record.boss_icon || '👹'} {name}</span>
      ),
    },
    {
      title: '等级',
      dataIndex: 'boss_level',
      key: 'boss_level',
      render: (lv: number) => <Tag color="red">Lv.{lv}</Tag>,
    },
    {
      title: '血量',
      key: 'hp',
      render: (_: any, record: any) => {
        const totalDmg = record.total_damage || 0;
        const remaining = Math.max(0, record.boss_max_hp - totalDmg);
        const pct = record.boss_max_hp > 0 ? Math.round((totalDmg / record.boss_max_hp) * 100) : 0;
        return (
          <div style={{ minWidth: 120 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>{remaining}/{record.boss_max_hp}</div>
            <Progress percent={Math.min(100, pct)} size="small" strokeColor="#f5222d" />
          </div>
        );
      },
    },
    {
      title: '知识点',
      dataIndex: 'knowledge_point',
      key: 'knowledge_point',
      render: (kp: string) => kp ? <Tag color="blue">{kp}</Tag> : '-',
    },
    {
      title: '参与',
      dataIndex: 'participant_count',
      key: 'participant_count',
      render: (count: number) => count ? <Tag icon={<TeamOutlined />}>{count}人</Tag> : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const cfg = statusConfig[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (t: string) => t ? new Date(t).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record.id)}>详情</Button>
          {record.status === 'active' && (
            <Popconfirm title="确定要终止此BOSS战吗？" onConfirm={() => handleTerminate(record.id)}>
              <Button size="small" danger icon={<StopOutlined />}>终止</Button>
            </Popconfirm>
          )}
          {record.status !== 'active' && (
            <Popconfirm title="确定要删除此BOSS记录吗？" onConfirm={() => handleDelete(record.id)}>
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space>
          <span style={{ fontWeight: 'bold' }}>选择班级：</span>
          <Select
            value={selectedClassId}
            onChange={setSelectedClassId}
            style={{ width: 200 }}
            options={headClasses.map((c: any) => ({ label: `${c.name} (班主任)`, value: c.id }))}
            placeholder="请选择班级"
          />
        </Space>
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreateOpen}
            disabled={!selectedClassId || !!currentBoss}
          >
            创建BOSS
          </Button>
          <Button
            icon={<SwapOutlined />}
            onClick={handleAutoGenerate}
            loading={autoGenerating}
            disabled={!selectedClassId || !!currentBoss}
          >
            从错题自动生成
          </Button>
        </Space>
      </div>

      {!selectedClassId && headClasses.length === 0 && (
        <Alert
          type="warning"
          message="您不是任何班级的班主任"
          description="只有班主任才能创建和管理BOSS战，请联系管理员设置班主任身份。"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {currentBoss && (
        <Card
          title={<span><FireOutlined style={{ color: '#f5222d' }} /> 当前活跃BOSS</span>}
          style={{ borderRadius: 12, marginBottom: 24 }}
          extra={
            <Space>
              <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(currentBoss.id)}>详情</Button>
              <Popconfirm title="确定要终止此BOSS战吗？" onConfirm={() => handleTerminate(currentBoss.id)}>
                <Button size="small" danger icon={<StopOutlined />}>终止</Button>
              </Popconfirm>
            </Space>
          }
        >
          <Row gutter={[24, 16]}>
            <Col xs={24} md={8} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 80 }}>{currentBoss.boss_icon || '👹'}</div>
              <h3>{currentBoss.boss_name}</h3>
              <Tag color="red">Lv.{currentBoss.boss_level}</Tag>
              {currentBoss.knowledge_point && <Tag color="blue">{currentBoss.knowledge_point}</Tag>}
            </Col>
            <Col xs={24} md={16}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>BOSS血量</span>
                  <span>{currentBoss.current_hp} / {currentBoss.boss_max_hp}</span>
                </div>
                <Progress
                  percent={currentBoss.progress || 0}
                  strokeColor={{ from: '#f5222d', to: '#fa8c16' }}
                  strokeWidth={16}
                />
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic title="参与人数" value={currentBoss.participant_count || 0} prefix={<TeamOutlined />} />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="剩余时间"
                    value={currentBoss.expires_at ? Math.max(0, Math.floor((new Date(currentBoss.expires_at).getTime() - Date.now()) / (1000 * 60 * 60))) : 0}
                    suffix="小时"
                    prefix={<ClockCircleOutlined />}
                  />
                </Col>
                <Col span={8}>
                  <Statistic title="BOSS等级" value={currentBoss.boss_level} prefix={<ThunderboltOutlined />} />
                </Col>
              </Row>
            </Col>
          </Row>
        </Card>
      )}

      <Card title="BOSS 历史记录" size="small">
        <Table
          dataSource={bossList}
          columns={bossColumns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          size="small"
          locale={{ emptyText: <Empty description={`${selectedClassName}暂无BOSS记录`} /> }}
        />
      </Card>

      <Modal
        title="⚔️ 创建BOSS战"
        open={createModalVisible}
        onCancel={() => { setCreateModalVisible(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        confirmLoading={creating}
        width={720}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Divider orientation="left">基本信息</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="boss_name" label="BOSS名称" rules={[{ required: true, message: '请输入BOSS名称' }]}>
                <Input placeholder="例如：暗影数学之王" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="boss_icon" label="BOSS图标">
                <Select options={BOSS_ICON_OPTIONS} placeholder="选择图标（空为随机）" allowClear />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="boss_level" label="BOSS等级" rules={[{ required: true, message: '请输入等级' }]} extra="影响默认血量">
                <InputNumber min={1} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="boss_hp" label="自定义血量" extra="留空则 = 等级×1000">
                <InputNumber min={100} style={{ width: '100%' }} placeholder="自动计算" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="duration_hours" label="持续时间(小时)" initialValue={24}>
                <InputNumber min={1} max={168} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="boss_description" label="BOSS描述">
            <Input.TextArea rows={2} placeholder="BOSS的背景故事（可选）" />
          </Form.Item>
          <Form.Item name="knowledge_point" label="关联知识点" extra="BOSS战题目将优先从该知识点选取">
            <Input placeholder="例如：二次函数、一元一次方程" />
          </Form.Item>

          <Divider orientation="left">题目来源</Divider>
          <Form.Item name="question_source" label="出题方式">
            <Select onChange={(v) => setQuestionSource(v)}>
              <Select.Option value="knowledge">按知识点随机出题</Select.Option>
              <Select.Option value="selected">从错题本选择题目</Select.Option>
            </Select>
          </Form.Item>

          {questionSource === 'selected' && (
            <Form.Item label="选择错题">
              {wrongQLoading ? <Spin /> : (
                wrongQuestions.length === 0 ? (
                  <Empty description="暂无错题数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <Checkbox.Group
                    value={selectedQuestionIds}
                    onChange={(vals) => setSelectedQuestionIds(vals as number[])}
                    style={{ width: '100%' }}
                  >
                    <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #d9d9d9', borderRadius: 8, padding: 8 }}>
                      {wrongQuestions.map((wq: any) => (
                        <div key={wq.question_id} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                          <Checkbox value={wq.question_id}>
                            <Tag color="blue" style={{ marginRight: 4 }}>{wq.topic || wq.knowledge_point}</Tag>
                            <Tag>{wq.difficulty}</Tag>
                            <span style={{ fontSize: 12, color: '#999' }}>{wq.error_student_count}人错</span>
                            <div style={{ fontSize: 12, color: '#666', marginTop: 2, marginLeft: 24 }}>
                              {wq.content?.substring(0, 60)}...
                            </div>
                          </Checkbox>
                        </div>
                      ))}
                    </div>
                  </Checkbox.Group>
                )
              )}
              {selectedQuestionIds.length > 0 && (
                <div style={{ marginTop: 8, color: '#1890ff' }}>已选择 {selectedQuestionIds.length} 道题目</div>
              )}
            </Form.Item>
          )}

          <Divider orientation="left">奖励配置</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="reward_gold" label="金币奖励池" extra="按伤害比例分配">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="默认=等级×100" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="reward_exp" label="经验奖励池" extra="按伤害比例分配">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="默认=等级×50" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="reward_equipment_id" label="装备奖励" extra="伤害前15%可获得">
                <Select
                  placeholder="无装备奖励"
                  allowClear
                  options={equipmentList.map((e: any) => ({ label: `${e.rarity === 'legendary' ? '🌟' : e.rarity === 'epic' ? '💜' : e.rarity === 'rare' ? '💙' : '⚪'} ${e.name}`, value: e.id }))}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title="📊 BOSS战详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={<Button onClick={() => setDetailModalVisible(false)}>关闭</Button>}
        width={700}
      >
        {detailData && (
          <div>
            <Row gutter={[24, 16]} style={{ marginBottom: 16 }}>
              <Col span={8} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 64 }}>{detailData.boss.boss_icon || '👹'}</div>
                <h3>{detailData.boss.boss_name}</h3>
                <Tag color="red">Lv.{detailData.boss.boss_level}</Tag>
              </Col>
              <Col span={16}>
                <Descriptions column={2} size="small">
                  <Descriptions.Item label="血量">{detailData.boss.current_hp}/{detailData.boss.boss_max_hp}</Descriptions.Item>
                  <Descriptions.Item label="总伤害">{detailData.boss.total_damage}</Descriptions.Item>
                  <Descriptions.Item label="参与人数">{detailData.boss.participant_count}</Descriptions.Item>
                  <Descriptions.Item label="知识点">{detailData.boss.knowledge_point || '-'}</Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={statusConfig[detailData.boss.status]?.color}>{statusConfig[detailData.boss.status]?.label || detailData.boss.status}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="创建时间">{detailData.boss.created_at ? new Date(detailData.boss.created_at).toLocaleString() : '-'}</Descriptions.Item>
                </Descriptions>
                {detailData.reward_config && detailData.reward_config.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <span style={{ fontWeight: 'bold' }}>奖励配置：</span>
                    {detailData.reward_config.map((rc: any, idx: number) => (
                      <Tag key={idx} color="gold">
                        {rc.reward_type === 'gold' ? '💰' : rc.reward_type === 'exp' ? '⭐' : '⚔️'} {rc.reward_value} {rc.reward_type === 'gold' ? '金币' : rc.reward_type === 'exp' ? '经验' : '装备'}
                      </Tag>
                    ))}
                  </div>
                )}
              </Col>
            </Row>

            {detailData.participants && detailData.participants.length > 0 && (
              <Card title="🏆 参与排行" size="small">
                <List
                  size="small"
                  dataSource={detailData.participants.slice(0, 10)}
                  renderItem={(item: any, index: number) => (
                    <List.Item>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                        <Badge count={index + 1} style={{ backgroundColor: index < 3 ? '#f5222d' : '#d9d9d9' }} />
                        <span style={{ flex: 1 }}>{item.username}</span>
                        <span style={{ color: '#999', fontSize: 12 }}>
                          正确 {item.correct_answers}/{item.total_attempts}
                        </span>
                        <Tag color="red">{item.damage_dealt} 伤害</Tag>
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default BossBattleManager;
