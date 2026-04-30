import React, { useEffect, useState } from 'react';
import {
  Card, Table, Button, Form, Input, message, Tag, Space, Modal, Select,
  InputNumber, Popconfirm, Tooltip
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, TrophyOutlined } from '@ant-design/icons';
import { achievementAPI } from '../../utils/api';

interface ConditionType {
  type: string;
  label: string;
  category: string;
  thresholdKey: string;
  thresholdLabel: string;
  extraField?: string;
  extraLabel?: string;
  extraDefault?: number;
  description: string;
}

const categoryLabels: Record<string, string> = {
  pet: '宠物',
  battle: '战斗',
  learning: '学习',
  social: '社交',
  collection: '收集',
  special: '综合',
};

const categoryColors: Record<string, string> = {
  pet: 'green',
  battle: 'red',
  learning: 'blue',
  social: 'purple',
  collection: 'gold',
  special: 'default',
};

const rewardTypeLabels: Record<string, string> = {
  gold: '金币',
  exp: '经验',
  item: '道具',
};

const AchievementManagement: React.FC = () => {
  const [achievements, setAchievements] = useState<any[]>([]);
  const [conditionTypes, setConditionTypes] = useState<ConditionType[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [achTablePage, setAchTablePage] = useState(1);
  const [achTablePageSize, setAchTablePageSize] = useState(15);
  const [form] = Form.useForm();

  const selectedCondType = Form.useWatch('cond_type', form) as string | undefined;
  const selectedRewardType = Form.useWatch('reward_type', form) as string | undefined;

  const condMeta = conditionTypes.find(c => c.type === selectedCondType);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [achRes, condRes, itemRes] = await Promise.all([
        achievementAPI.getAchievements(),
        achievementAPI.getConditionTypes(),
        achievementAPI.adminGetItems(),
      ]);
      setAchievements(achRes.data.achievements || []);
      setConditionTypes(condRes.data.types || []);
      setItems(itemRes.data.items || []);
    } catch (e: any) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ reward_type: 'gold', category: 'special', icon: '🏆', sort_order: 0 });
    setModalVisible(true);
  };

  const handleEdit = (record: any) => {
    setEditingId(record.id);
    const cond = (() => { try { return JSON.parse(record.condition); } catch { return {}; } })();
    const condType = cond.type || '';
    const thresholdKey = Object.keys(cond).find(k => k !== 'type') || '';
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      category: record.category || 'special',
      icon: record.icon || '🏆',
      sort_order: record.sort_order || 0,
      cond_type: condType,
      threshold: cond[thresholdKey] || 0,
      extra_value: cond.score || undefined,
      reward_type: record.reward_type,
      reward_value: record.reward_value,
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await achievementAPI.adminDelete(id);
      message.success('删除成功');
      loadData();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const meta = conditionTypes.find(c => c.type === values.cond_type);
      if (!meta) {
        message.error('请选择条件类型');
        return;
      }

      const condition: Record<string, any> = { type: meta.type };
      condition[meta.thresholdKey] = values.threshold;
      if (meta.extraField && values.extra_value !== undefined) {
        condition[meta.extraField] = values.extra_value;
      }

      const payload = {
        name: values.name,
        description: values.description || '',
        condition: JSON.stringify(condition),
        reward_type: values.reward_type,
        reward_value: values.reward_value || 0,
        category: values.category || 'special',
        icon: values.icon || '🏆',
        sort_order: values.sort_order || 0,
      };

      if (editingId) {
        await achievementAPI.adminUpdate(editingId, payload);
        message.success('更新成功');
      } else {
        await achievementAPI.adminCreate(payload);
        message.success('创建成功');
      }

      setModalVisible(false);
      loadData();
    } catch (e: any) {
      if (e?.response?.data?.error) {
        message.error(e.response.data.error);
      }
    }
  };

  // 按 category 分组条件类型
  const groupedCondTypes = conditionTypes.reduce((acc, ct) => {
    (acc[ct.category] = acc[ct.category] || []).push(ct);
    return acc;
  }, {} as Record<string, ConditionType[]>);

  const columns = [
    {
      title: '图标', dataIndex: 'icon', key: 'icon', width: 50,
      render: (v: string) => <span style={{ fontSize: 20 }}>{v}</span>,
    },
    { title: '名称', dataIndex: 'name', key: 'name', width: 150 },
    {
      title: '分类', dataIndex: 'category', key: 'category', width: 80,
      render: (v: string) => <Tag color={categoryColors[v] || 'default'}>{categoryLabels[v] || v}</Tag>,
    },
    {
      title: '条件', key: 'condition', width: 200,
      render: (_: any, record: any) => {
        const cond = (() => { try { return JSON.parse(record.condition); } catch { return {}; } })();
        const meta = conditionTypes.find(c => c.type === cond.type);
        const thresholdKey = Object.keys(cond).find(k => k !== 'type');
        const label = meta?.label || cond.type;
        const thresholdLabel = meta?.thresholdLabel || '';
        return <span>{label} ≥ {cond[thresholdKey || ''] || '?'}{thresholdLabel}</span>;
      },
    },
    {
      title: '奖励', key: 'reward', width: 120,
      render: (_: any, record: any) => (
        <Tag color={record.reward_type === 'gold' ? 'gold' : record.reward_type === 'exp' ? 'blue' : 'green'}>
          {record.reward_value} {rewardTypeLabels[record.reward_type] || record.reward_type}
        </Tag>
      ),
    },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: any, record: any) => (
        <Space>
          <Tooltip title="编辑"><Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)} /></Tooltip>
          <Popconfirm title="确定删除此成就？" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除"><Button type="link" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={<><TrophyOutlined /> 成就管理</>}
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>创建成就</Button>}
    >
      <Table
        dataSource={achievements}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{
          current: achTablePage,
          pageSize: achTablePageSize,
          onChange: (page, size) => { setAchTablePage(page); setAchTablePageSize(size); },
          showSizeChanger: true,
          pageSizeOptions: ['10', '15', '20', '50'],
          showTotal: (total) => `共 ${total} 条`
        }}
      />

      <Modal
        title={editingId ? '编辑成就' : '创建成就'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSubmit}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="成就名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：初出茅庐" />
          </Form.Item>

          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="成就描述（可选）" />
          </Form.Item>

          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item name="category" label="分类" style={{ flex: 1 }}>
              <Select options={Object.entries(categoryLabels).map(([k, v]) => ({ label: v, value: k }))} />
            </Form.Item>
            <Form.Item name="icon" label="图标" style={{ width: 100 }}>
              <Input placeholder="🏆" />
            </Form.Item>
            <Form.Item name="sort_order" label="排序">
              <InputNumber min={0} style={{ width: 80 }} />
            </Form.Item>
          </Space>

          <Form.Item name="cond_type" label="条件类型" rules={[{ required: true, message: '请选择条件类型' }]}>
            <Select
              placeholder="选择条件类型"
              showSearch
              optionFilterProp="label"
              options={Object.entries(groupedCondTypes).map(([cat, types]) => ({
                label: categoryLabels[cat] || cat,
                options: types.map(t => ({
                  label: `${t.label} — ${t.description}`,
                  value: t.type,
                })),
              }))}
            />
          </Form.Item>

          {condMeta && (
            <Space size="middle" style={{ display: 'flex' }}>
              <Form.Item
                name="threshold"
                label={condMeta.thresholdLabel || '阈值'}
                rules={[{ required: true, message: '请输入阈值' }]}
                style={{ flex: 1 }}
              >
                <InputNumber min={1} style={{ width: '100%' }} placeholder={`达到多少${condMeta.thresholdLabel}`} />
              </Form.Item>
              {condMeta.extraField && (
                <Form.Item
                  name="extra_value"
                  label={condMeta.extraLabel || condMeta.extraField}
                  initialValue={condMeta.extraDefault}
                  style={{ flex: 1 }}
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              )}
            </Space>
          )}

          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item name="reward_type" label="奖励类型" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={Object.entries(rewardTypeLabels).map(([k, v]) => ({ label: v, value: k }))} />
            </Form.Item>
            <Form.Item
              name="reward_value"
              label={selectedRewardType === 'item' ? '道具' : '奖励数值'}
              rules={[{ required: true, message: '请填写奖励' }]}
              style={{ flex: 1 }}
            >
              {selectedRewardType === 'item' ? (
                <Select
                  placeholder="选择道具"
                  showSearch
                  optionFilterProp="label"
                  options={items.map((i: any) => ({ label: `${i.name} (${i.price}金)`, value: i.id }))}
                />
              ) : (
                <InputNumber min={1} style={{ width: '100%' }} />
              )}
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
};

export default AchievementManagement;
