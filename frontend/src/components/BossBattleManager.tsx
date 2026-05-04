import React, { useEffect, useState } from 'react';
import {
  Card, Table, Button, Form, Input, InputNumber, Select, Tag, Space, Modal,
  Row, Col, Descriptions, Progress, Popconfirm, Empty, Spin, message,
  Checkbox, Divider, Alert, Statistic, Tabs,
} from 'antd';
import {
  FireOutlined, PlusOutlined, DeleteOutlined, StopOutlined,
  EyeOutlined, ThunderboltOutlined, TeamOutlined,
  ClockCircleOutlined, SwapOutlined,
} from '@ant-design/icons';
import { bossBattleAPI, equipmentAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

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
  const isMobile = useMobile();
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
  const [questionBankQuestions, setQuestionBankQuestions] = useState<any[]>([]);
  const [questionSource, setQuestionSource] = useState<string>('knowledge');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);
  const [wrongQLoading, setWrongQLoading] = useState(false);
  const [questionBankLoading, setQuestionBankLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('active');

  const [wrongQPage, setWrongQPage] = useState(1);
  const [wrongQTotal, setWrongQTotal] = useState(0);
  const [wrongQPageSize] = useState(10);
  const [wrongQFilters, setWrongQFilters] = useState<{ subject?: string; type?: string; difficulty?: string; keyword?: string }>({});

  const [qbPage, setQbPage] = useState(1);
  const [qbTotal, setQbTotal] = useState(0);
  const [qbPageSize] = useState(10);
  const [qbFilters, setQbFilters] = useState<{ subject?: string; type?: string; difficulty?: string; keyword?: string }>({});

  const [questionSelectTab, setQuestionSelectTab] = useState<string>('wrong');

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

  const loadWrongQuestions = async (page = 1, filters = wrongQFilters) => {
    if (!selectedClassId) return;
    setWrongQLoading(true);
    try {
      const res = await bossBattleAPI.getWrongQuestions(selectedClassId, {
        page,
        pageSize: wrongQPageSize,
        ...filters,
      });
      setWrongQuestions(res.data.wrongQuestions || []);
      setWrongQTotal(res.data.total || 0);
      setWrongQPage(res.data.page || 1);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载错题失败');
    } finally {
      setWrongQLoading(false);
    }
  };

  const loadQuestionBank = async (page = 1, filters = qbFilters) => {
    setQuestionBankLoading(true);
    try {
      const res = await bossBattleAPI.getQuestions({
        page,
        pageSize: qbPageSize,
        ...filters,
      });
      setQuestionBankQuestions(res.data.questions || []);
      setQbTotal(res.data.total || 0);
      setQbPage(res.data.page || 1);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载题库失败');
    } finally {
      setQuestionBankLoading(false);
    }
  };

  const handleCreateOpen = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      duration_hours: 168,
      boss_level: 5,
      question_source: 'knowledge',
    });
    setQuestionSource('knowledge');
    setSelectedQuestionIds([]);
    setWrongQFilters({});
    setQbFilters({});
    setWrongQPage(1);
    setQbPage(1);
    setQuestionSelectTab('wrong');
    loadEquipment();
    loadWrongQuestions(1, {});
    loadQuestionBank(1, {});
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
        question_ids: (values.question_source === 'wrong_questions' || values.question_source === 'question_bank' || values.question_source === 'selected') ? selectedQuestionIds : undefined,
        max_questions_per_user: values.max_questions_per_user ?? 20,
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

  const activeBosses = bossList.filter((b: any) => b.status === 'active');
  const endedBosses = bossList.filter((b: any) => b.status !== 'active');

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
      responsive: ['md'] as any,
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
      responsive: ['md'] as any,
      render: (kp: string) => kp ? <Tag color="blue">{kp}</Tag> : '-',
    },
    {
      title: '参与',
      dataIndex: 'participant_count',
      key: 'participant_count',
      responsive: ['md'] as any,
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
      responsive: ['lg'] as any,
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

  const renderMobileBossCard = (record: any) => (
    <Card key={record.id} size="small" style={{ marginBottom: 10, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 20, marginRight: 6 }}>{record.boss_icon || '👹'}</span>
          <span style={{ fontWeight: 'bold', fontSize: 14 }}>{record.boss_name}</span>
        </div>
        <Tag color={statusConfig[record.status]?.color}>{statusConfig[record.status]?.label || record.status}</Tag>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Tag color="red">Lv.{record.boss_level}</Tag>
        {record.knowledge_point && <Tag color="blue">{record.knowledge_point}</Tag>}
        {record.participant_count ? <Tag icon={<TeamOutlined />}>{record.participant_count}人</Tag> : null}
      </div>
      {record.boss_max_hp > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>
            血量 {Math.max(0, record.boss_max_hp - (record.total_damage || 0))}/{record.boss_max_hp}
          </div>
          <Progress
            percent={Math.min(100, record.boss_max_hp > 0 ? Math.round(((record.total_damage || 0) / record.boss_max_hp) * 100) : 0)}
            size="small"
            strokeColor="#f5222d"
          />
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
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
      </div>
    </Card>
  );

  const renderActiveTab = () => (
    <div>
      {currentBoss ? (
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
              <div style={{ fontSize: isMobile ? 56 : 80 }}>{currentBoss.boss_icon || '👹'}</div>
              <h3 style={{ fontSize: isMobile ? 16 : undefined }}>{currentBoss.boss_name}</h3>
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
                  size={16}
                />
              </div>
              <Row gutter={16}>
                <Col xs={8}>
                  <Statistic title="参与人数" value={currentBoss.participant_count || 0} prefix={<TeamOutlined />} valueStyle={{ fontSize: isMobile ? 16 : undefined }} />
                </Col>
                <Col xs={8}>
                  <Statistic
                    title="剩余时间"
                    value={currentBoss.expires_at ? Math.max(0, Math.floor((new Date(currentBoss.expires_at).getTime() - Date.now()) / (1000 * 60 * 60))) : 0}
                    suffix="小时"
                    prefix={<ClockCircleOutlined />}
                    valueStyle={{ fontSize: isMobile ? 16 : undefined }}
                  />
                </Col>
                <Col xs={8}>
                  <Statistic title="BOSS等级" value={currentBoss.boss_level} prefix={<ThunderboltOutlined />} valueStyle={{ fontSize: isMobile ? 16 : undefined }} />
                </Col>
              </Row>
            </Col>
          </Row>
        </Card>
      ) : (
        <Card style={{ borderRadius: 12, marginBottom: 24 }}>
          <Empty
            description={
              <span>
                当前没有活跃的BOSS战<br />
                <span style={{ color: '#999', fontSize: 12 }}>点击上方「创建BOSS」或「从错题自动生成」来开启一场BOSS战</span>
              </span>
            }
            style={{ padding: '20px 0' }}
          />
        </Card>
      )}

      {activeBosses.filter((b: any) => !currentBoss || b.id !== currentBoss.id).length > 0 && (
        <Card title="其他进行中的BOSS" size="small" style={{ marginBottom: 16 }}>
          {isMobile ? (
            activeBosses.filter((b: any) => !currentBoss || b.id !== currentBoss.id).map((record: any) => renderMobileBossCard(record))
          ) : (
            <Table
              dataSource={activeBosses.filter((b: any) => !currentBoss || b.id !== currentBoss.id)}
              columns={bossColumns}
              rowKey="id"
              pagination={false}
              size="small"
            />
          )}
        </Card>
      )}
    </div>
  );

  const renderEndedBossCard = (record: any) => {
    const totalDmg = record.total_damage || 0;
    const remaining = Math.max(0, record.boss_max_hp - totalDmg);
    const pct = record.boss_max_hp > 0 ? Math.round((totalDmg / record.boss_max_hp) * 100) : 0;
    const endTime = record.completed_at || record.expires_at;
    return (
      <Card key={record.id} size="small" style={{ marginBottom: 10, borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <span style={{ fontSize: 20, marginRight: 6 }}>{record.boss_icon || '👹'}</span>
            <span style={{ fontWeight: 'bold', fontSize: 14 }}>{record.boss_name}</span>
          </div>
          <Tag color={statusConfig[record.status]?.color}>{statusConfig[record.status]?.label || record.status}</Tag>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <Tag color="red">Lv.{record.boss_level}</Tag>
          {record.knowledge_point && <Tag color="blue">{record.knowledge_point}</Tag>}
          {record.participant_count ? <Tag icon={<TeamOutlined />}>{record.participant_count}人参与</Tag> : <Tag>0人参与</Tag>}
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>
            血量 {remaining}/{record.boss_max_hp} · 进度 {pct}%
          </div>
          <Progress percent={Math.min(100, pct)} size="small" strokeColor={record.status === 'defeated' ? '#52c41a' : '#d9d9d9'} />
        </div>
        {endTime && (
          <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
            结束于 {new Date(endTime).toLocaleString()}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record.id)}>详情</Button>
          <Popconfirm title="确定要删除此BOSS记录吗？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </div>
      </Card>
    );
  };

  const endedBossColumns = [
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
      title: '进度',
      key: 'progress',
      render: (_: any, record: any) => {
        const totalDmg = record.total_damage || 0;
        const pct = record.boss_max_hp > 0 ? Math.round((totalDmg / record.boss_max_hp) * 100) : 0;
        return <Progress percent={Math.min(100, pct)} size="small" strokeColor={record.status === 'defeated' ? '#52c41a' : '#d9d9d9'} />;
      },
    },
    {
      title: '参与',
      dataIndex: 'participant_count',
      key: 'participant_count',
      render: (count: number) => count ? <Tag icon={<TeamOutlined />}>{count}人</Tag> : <Tag>0人</Tag>,
    },
    {
      title: '结果',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const cfg = statusConfig[s] || { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '结束时间',
      key: 'end_time',
      responsive: ['lg'] as any,
      render: (_: any, record: any) => {
        const t = record.completed_at || record.expires_at;
        return t ? new Date(t).toLocaleString() : '-';
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record.id)}>详情</Button>
          <Popconfirm title="确定要删除此BOSS记录吗？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderEndedTab = () => (
    <div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#999' }}>加载中...</div>
        </div>
      ) : endedBosses.length === 0 ? (
        <Empty
          description={`${selectedClassName}暂无已结束的BOSS战记录`}
          style={{ marginTop: 40 }}
        />
      ) : isMobile ? (
        endedBosses.map((record: any) => renderEndedBossCard(record))
      ) : (
        <Table
          dataSource={endedBosses}
          columns={endedBossColumns}
          rowKey="id"
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          size="small"
          locale={{ emptyText: <Empty description={`${selectedClassName}暂无已结束的BOSS战记录`} /> }}
        />
      )}
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space>
          <span style={{ fontWeight: 'bold' }}>选择班级：</span>
          <Select
            value={selectedClassId}
            onChange={setSelectedClassId}
            style={{ width: isMobile ? 150 : 200 }}
            options={headClasses.map((c: any) => ({ label: `${c.name} (班主任)`, value: c.id }))}
            placeholder="请选择班级"
          />
        </Space>
        <Space wrap>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreateOpen}
            disabled={!selectedClassId || !!currentBoss}
            size={isMobile ? 'small' : 'middle'}
          >
            创建BOSS
          </Button>
          <Button
            icon={<SwapOutlined />}
            onClick={handleAutoGenerate}
            loading={autoGenerating}
            disabled={!selectedClassId || !!currentBoss}
            size={isMobile ? 'small' : 'middle'}
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

      {!selectedClassId ? (
        <Empty description="请先选择一个班级" style={{ marginTop: 40 }} />
      ) : (
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key)}
          items={[
            {
              key: 'active',
              label: '⚔️ 进行中',
              children: renderActiveTab(),
            },
            {
              key: 'ended',
              label: `📋 已结束${endedBosses.length > 0 ? ` (${endedBosses.length})` : ''}`,
              children: renderEndedTab(),
            },
          ]}
        />
      )}

      <Modal
        title="⚔️ 创建BOSS战"
        open={createModalVisible}
        onCancel={() => { setCreateModalVisible(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        confirmLoading={creating}
        width={isMobile ? '95%' : 720}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Divider orientation="left">基本信息</Divider>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="boss_name" label="BOSS名称" rules={[{ required: true, message: '请输入BOSS名称' }]}>
                <Input placeholder="例如：暗影数学之王" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="boss_icon" label="BOSS图标">
                <Select options={BOSS_ICON_OPTIONS} placeholder="选择图标（空为随机）" allowClear />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item name="boss_level" label="BOSS等级" rules={[{ required: true, message: '请输入等级' }]} extra="影响默认血量">
                <InputNumber min={1} max={50} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="boss_hp" label="自定义血量" extra="留空则 = 等级×1000">
                <InputNumber min={100} style={{ width: '100%' }} placeholder="自动计算" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="duration_hours" label="截止时间" initialValue={168}>
                <Select
                  options={[
                    { label: '1 天', value: 24 },
                    { label: '3 天', value: 72 },
                    { label: '7 天（推荐）', value: 168 },
                    { label: '14 天', value: 336 },
                    { label: '30 天', value: 720 },
                  ]}
                />
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
            <Select onChange={(v) => {
              setQuestionSource(v);
              setSelectedQuestionIds([]);
            }}>
              <Select.Option value="knowledge">按知识点随机出题</Select.Option>
              <Select.Option value="wrong_questions">从错题本选择题目</Select.Option>
              <Select.Option value="question_bank">从题库选择题目</Select.Option>
            </Select>
          </Form.Item>

          {(questionSource === 'wrong_questions' || questionSource === 'question_bank' || questionSource === 'selected') && (
            <Form.Item label="选择题目">
              <Tabs
                activeKey={questionSelectTab}
                onChange={(key) => {
                  setQuestionSelectTab(key);
                  setSelectedQuestionIds([]);
                  if (key === 'wrong') loadWrongQuestions(1, wrongQFilters);
                  if (key === 'bank') loadQuestionBank(1, qbFilters);
                }}
                size="small"
                items={[
                  {
                    key: 'wrong',
                    label: isMobile ? `错题本${wrongQTotal > 0 ? `(${wrongQTotal})` : ''}` : `📝 错题本${wrongQTotal > 0 ? ` (${wrongQTotal})` : ''}`,
                    children: (
                      <div>
                        {isMobile ? (
                          <div style={{ marginBottom: 8 }}>
                            <Row gutter={[8, 8]}>
                              <Col span={12}>
                                <Select
                                  placeholder="科目"
                                  allowClear
                                  size="small"
                                  style={{ width: '100%' }}
                                  value={wrongQFilters.subject}
                                  onChange={(v) => {
                                    const f = { ...wrongQFilters, subject: v };
                                    setWrongQFilters(f);
                                    loadWrongQuestions(1, f);
                                  }}
                                  options={(wrongQuestions.length > 0
                                    ? [...new Set(wrongQuestions.map((q: any) => q.subject))].map(s => ({ label: s, value: s }))
                                    : [])}
                                />
                              </Col>
                              <Col span={12}>
                                <Select
                                  placeholder="题型"
                                  allowClear
                                  size="small"
                                  style={{ width: '100%' }}
                                  value={wrongQFilters.type}
                                  onChange={(v) => {
                                    const f = { ...wrongQFilters, type: v };
                                    setWrongQFilters(f);
                                    loadWrongQuestions(1, f);
                                  }}
                                  options={[
                                    { label: '单选题', value: 'choice_single' },
                                    { label: '多选题', value: 'choice_multi' },
                                    { label: '判断题', value: 'judgment' },
                                    { label: '填空题', value: 'fill_blank' },
                                  ]}
                                />
                              </Col>
                              <Col span={12}>
                                <Select
                                  placeholder="难度"
                                  allowClear
                                  size="small"
                                  style={{ width: '100%' }}
                                  value={wrongQFilters.difficulty}
                                  onChange={(v) => {
                                    const f = { ...wrongQFilters, difficulty: v };
                                    setWrongQFilters(f);
                                    loadWrongQuestions(1, f);
                                  }}
                                  options={[
                                    { label: '简单', value: 'easy' },
                                    { label: '中等', value: 'medium' },
                                    { label: '困难', value: 'hard' },
                                  ]}
                                />
                              </Col>
                              <Col span={12}>
                                <Input.Search
                                  placeholder="搜索"
                                  allowClear
                                  size="small"
                                  style={{ width: '100%' }}
                                  value={wrongQFilters.keyword}
                                  onChange={(e) => {
                                    const f = { ...wrongQFilters, keyword: e.target.value };
                                    setWrongQFilters(f);
                                  }}
                                  onSearch={() => loadWrongQuestions(1, wrongQFilters)}
                                />
                              </Col>
                            </Row>
                          </div>
                        ) : (
                          <Space wrap style={{ marginBottom: 8 }}>
                            <Select
                              placeholder="科目"
                              allowClear
                              size="small"
                              style={{ width: 100 }}
                              value={wrongQFilters.subject}
                              onChange={(v) => {
                                const f = { ...wrongQFilters, subject: v };
                                setWrongQFilters(f);
                                loadWrongQuestions(1, f);
                              }}
                              options={(wrongQuestions.length > 0
                                ? [...new Set(wrongQuestions.map((q: any) => q.subject))].map(s => ({ label: s, value: s }))
                                : [])}
                            />
                            <Select
                              placeholder="题型"
                              allowClear
                              size="small"
                              style={{ width: 100 }}
                              value={wrongQFilters.type}
                              onChange={(v) => {
                                const f = { ...wrongQFilters, type: v };
                                setWrongQFilters(f);
                                loadWrongQuestions(1, f);
                              }}
                              options={[
                                { label: '单选题', value: 'choice_single' },
                                { label: '多选题', value: 'choice_multi' },
                                { label: '判断题', value: 'judgment' },
                                { label: '填空题', value: 'fill_blank' },
                              ]}
                            />
                            <Select
                              placeholder="难度"
                              allowClear
                              size="small"
                              style={{ width: 90 }}
                              value={wrongQFilters.difficulty}
                              onChange={(v) => {
                                const f = { ...wrongQFilters, difficulty: v };
                                setWrongQFilters(f);
                                loadWrongQuestions(1, f);
                              }}
                              options={[
                                { label: '简单', value: 'easy' },
                                { label: '中等', value: 'medium' },
                                { label: '困难', value: 'hard' },
                              ]}
                            />
                            <Input.Search
                              placeholder="搜索关键词"
                              allowClear
                              size="small"
                              style={{ width: 150 }}
                              value={wrongQFilters.keyword}
                              onChange={(e) => {
                                const f = { ...wrongQFilters, keyword: e.target.value };
                                setWrongQFilters(f);
                              }}
                              onSearch={() => loadWrongQuestions(1, wrongQFilters)}
                            />
                          </Space>
                        )}
                        {wrongQLoading ? <Spin /> : (
                          wrongQuestions.length === 0 ? (
                            <Empty description="暂无错题数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                          ) : (
                            <>
                              <Checkbox.Group
                                value={selectedQuestionIds}
                                onChange={(vals) => setSelectedQuestionIds(vals as number[])}
                                style={{ width: '100%' }}
                              >
                                <div style={{
                                  maxHeight: isMobile ? 250 : 300,
                                  overflow: 'auto',
                                  border: '1px solid #d9d9d9',
                                  borderRadius: 8,
                                  padding: isMobile ? 4 : 8,
                                }}>
                                  {wrongQuestions.map((wq: any) => (
                                    <div
                                      key={wq.question_id}
                                      style={{
                                        padding: isMobile ? '6px 4px' : '4px 0',
                                        borderBottom: '1px solid #f0f0f0',
                                      }}
                                    >
                                      <Checkbox value={wq.question_id} style={isMobile ? { width: '100%', padding: '4px 0' } : undefined}>
                                        <Tag color="blue" style={{ marginRight: 4, fontSize: isMobile ? 10 : 12 }}>{wq.topic || wq.knowledge_point || wq.subject}</Tag>
                                        <Tag color={wq.difficulty === 'easy' ? 'green' : wq.difficulty === 'hard' ? 'red' : 'orange'} style={{ fontSize: isMobile ? 10 : 12 }}>{wq.difficulty}</Tag>
                                        {!isMobile && <span style={{ fontSize: 12, color: '#999' }}>{wq.error_student_count}人错</span>}
                                        <div style={{
                                          fontSize: isMobile ? 11 : 12,
                                          color: '#666',
                                          marginTop: 2,
                                          marginLeft: isMobile ? 0 : 24,
                                          lineHeight: isMobile ? '1.3' : undefined,
                                        }}>
                                          {wq.content?.substring(0, isMobile ? 50 : 80)}...
                                          {isMobile && <span style={{ color: '#999', marginLeft: 4 }}>{wq.error_student_count}人错</span>}
                                        </div>
                                      </Checkbox>
                                    </div>
                                  ))}
                                </div>
                              </Checkbox.Group>
                              {wrongQTotal > wrongQPageSize && (
                                <div style={{ textAlign: 'center', marginTop: 8 }}>
                                  <Button
                                    size={isMobile ? 'middle' : 'small'}
                                    disabled={wrongQPage <= 1}
                                    onClick={() => loadWrongQuestions(wrongQPage - 1, wrongQFilters)}
                                    style={isMobile ? { minWidth: 80 } : undefined}
                                  >上一页</Button>
                                  <span style={{ margin: '0 12px', fontSize: isMobile ? 13 : 12, color: '#999' }}>
                                    {wrongQPage} / {Math.ceil(wrongQTotal / wrongQPageSize)}
                                  </span>
                                  <Button
                                    size={isMobile ? 'middle' : 'small'}
                                    disabled={wrongQPage >= Math.ceil(wrongQTotal / wrongQPageSize)}
                                    onClick={() => loadWrongQuestions(wrongQPage + 1, wrongQFilters)}
                                    style={isMobile ? { minWidth: 80 } : undefined}
                                  >下一页</Button>
                                </div>
                              )}
                            </>
                          )
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'bank',
                    label: isMobile ? `题库${qbTotal > 0 ? `(${qbTotal})` : ''}` : `📚 题库${qbTotal > 0 ? ` (${qbTotal})` : ''}`,
                    children: (
                      <div>
                        {isMobile ? (
                          <div style={{ marginBottom: 8 }}>
                            <Row gutter={[8, 8]}>
                              <Col span={12}>
                                <Select
                                  placeholder="科目"
                                  allowClear
                                  size="small"
                                  style={{ width: '100%' }}
                                  value={qbFilters.subject}
                                  onChange={(v) => {
                                    const f = { ...qbFilters, subject: v };
                                    setQbFilters(f);
                                    loadQuestionBank(1, f);
                                  }}
                                  options={(questionBankQuestions.length > 0
                                    ? [...new Set(questionBankQuestions.map((q: any) => q.subject))].map(s => ({ label: s, value: s }))
                                    : [])}
                                />
                              </Col>
                              <Col span={12}>
                                <Select
                                  placeholder="题型"
                                  allowClear
                                  size="small"
                                  style={{ width: '100%' }}
                                  value={qbFilters.type}
                                  onChange={(v) => {
                                    const f = { ...qbFilters, type: v };
                                    setQbFilters(f);
                                    loadQuestionBank(1, f);
                                  }}
                                  options={[
                                    { label: '单选题', value: 'choice_single' },
                                    { label: '多选题', value: 'choice_multi' },
                                    { label: '判断题', value: 'judgment' },
                                    { label: '填空题', value: 'fill_blank' },
                                  ]}
                                />
                              </Col>
                              <Col span={12}>
                                <Select
                                  placeholder="难度"
                                  allowClear
                                  size="small"
                                  style={{ width: '100%' }}
                                  value={qbFilters.difficulty}
                                  onChange={(v) => {
                                    const f = { ...qbFilters, difficulty: v };
                                    setQbFilters(f);
                                    loadQuestionBank(1, f);
                                  }}
                                  options={[
                                    { label: '简单', value: 'easy' },
                                    { label: '中等', value: 'medium' },
                                    { label: '困难', value: 'hard' },
                                  ]}
                                />
                              </Col>
                              <Col span={12}>
                                <Input.Search
                                  placeholder="搜索"
                                  allowClear
                                  size="small"
                                  style={{ width: '100%' }}
                                  value={qbFilters.keyword}
                                  onChange={(e) => {
                                    const f = { ...qbFilters, keyword: e.target.value };
                                    setQbFilters(f);
                                  }}
                                  onSearch={() => loadQuestionBank(1, qbFilters)}
                                />
                              </Col>
                            </Row>
                          </div>
                        ) : (
                          <Space wrap style={{ marginBottom: 8 }}>
                            <Select
                              placeholder="科目"
                              allowClear
                              size="small"
                              style={{ width: 100 }}
                              value={qbFilters.subject}
                              onChange={(v) => {
                                const f = { ...qbFilters, subject: v };
                                setQbFilters(f);
                                loadQuestionBank(1, f);
                              }}
                              options={(questionBankQuestions.length > 0
                                ? [...new Set(questionBankQuestions.map((q: any) => q.subject))].map(s => ({ label: s, value: s }))
                                : [])}
                            />
                            <Select
                              placeholder="题型"
                              allowClear
                              size="small"
                              style={{ width: 100 }}
                              value={qbFilters.type}
                              onChange={(v) => {
                                const f = { ...qbFilters, type: v };
                                setQbFilters(f);
                                loadQuestionBank(1, f);
                              }}
                              options={[
                                { label: '单选题', value: 'choice_single' },
                                { label: '多选题', value: 'choice_multi' },
                                { label: '判断题', value: 'judgment' },
                                { label: '填空题', value: 'fill_blank' },
                              ]}
                            />
                            <Select
                              placeholder="难度"
                              allowClear
                              size="small"
                              style={{ width: 90 }}
                              value={qbFilters.difficulty}
                              onChange={(v) => {
                                const f = { ...qbFilters, difficulty: v };
                                setQbFilters(f);
                                loadQuestionBank(1, f);
                              }}
                              options={[
                                { label: '简单', value: 'easy' },
                                { label: '中等', value: 'medium' },
                                { label: '困难', value: 'hard' },
                              ]}
                            />
                            <Input.Search
                              placeholder="搜索关键词"
                              allowClear
                              size="small"
                              style={{ width: 150 }}
                              value={qbFilters.keyword}
                              onChange={(e) => {
                                const f = { ...qbFilters, keyword: e.target.value };
                                setQbFilters(f);
                              }}
                              onSearch={() => loadQuestionBank(1, qbFilters)}
                            />
                          </Space>
                        )}
                        {questionBankLoading ? <Spin /> : (
                          questionBankQuestions.length === 0 ? (
                            <Empty description="题库暂无题目" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                          ) : (
                            <>
                              <Checkbox.Group
                                value={selectedQuestionIds}
                                onChange={(vals) => setSelectedQuestionIds(vals as number[])}
                                style={{ width: '100%' }}
                              >
                                <div style={{
                                  maxHeight: isMobile ? 250 : 300,
                                  overflow: 'auto',
                                  border: '1px solid #d9d9d9',
                                  borderRadius: 8,
                                  padding: isMobile ? 4 : 8,
                                }}>
                                  {questionBankQuestions.map((q: any) => (
                                    <div
                                      key={q.id}
                                      style={{
                                        padding: isMobile ? '6px 4px' : '4px 0',
                                        borderBottom: '1px solid #f0f0f0',
                                      }}
                                    >
                                      <Checkbox value={q.id} style={isMobile ? { width: '100%', padding: '4px 0' } : undefined}>
                                        <Tag color="blue" style={{ marginRight: 4, fontSize: isMobile ? 10 : 12 }}>{q.topic || q.knowledge_point || q.subject}</Tag>
                                        <Tag color={q.difficulty === 'easy' ? 'green' : q.difficulty === 'hard' ? 'red' : 'orange'} style={{ fontSize: isMobile ? 10 : 12 }}>{q.difficulty}</Tag>
                                        <Tag style={{ fontSize: isMobile ? 10 : 12 }}>{q.type === 'choice_single' ? '单选' : q.type === 'choice_multi' ? '多选' : q.type === 'judgment' ? '判断' : q.type === 'fill_blank' ? '填空' : q.type}</Tag>
                                        <div style={{
                                          fontSize: isMobile ? 11 : 12,
                                          color: '#666',
                                          marginTop: 2,
                                          marginLeft: isMobile ? 0 : 24,
                                          lineHeight: isMobile ? '1.3' : undefined,
                                        }}>
                                          {q.content?.substring(0, isMobile ? 50 : 80)}...
                                        </div>
                                      </Checkbox>
                                    </div>
                                  ))}
                                </div>
                              </Checkbox.Group>
                              {qbTotal > qbPageSize && (
                                <div style={{ textAlign: 'center', marginTop: 8 }}>
                                  <Button
                                    size={isMobile ? 'middle' : 'small'}
                                    disabled={qbPage <= 1}
                                    onClick={() => loadQuestionBank(qbPage - 1, qbFilters)}
                                    style={isMobile ? { minWidth: 80 } : undefined}
                                  >上一页</Button>
                                  <span style={{ margin: '0 12px', fontSize: isMobile ? 13 : 12, color: '#999' }}>
                                    {qbPage} / {Math.ceil(qbTotal / qbPageSize)}
                                  </span>
                                  <Button
                                    size={isMobile ? 'middle' : 'small'}
                                    disabled={qbPage >= Math.ceil(qbTotal / qbPageSize)}
                                    onClick={() => loadQuestionBank(qbPage + 1, qbFilters)}
                                    style={isMobile ? { minWidth: 80 } : undefined}
                                  >下一页</Button>
                                </div>
                              )}
                            </>
                          )
                        )}
                      </div>
                    ),
                  },
                ]}
              />
              {selectedQuestionIds.length > 0 && (
                <div style={{ marginTop: 8, color: '#1890ff', fontWeight: 'bold', fontSize: isMobile ? 13 : 14 }}>
                  已选择 {selectedQuestionIds.length} 道题目
                </div>
              )}
            </Form.Item>
          )}

          <Divider orientation="left">奖励配置</Divider>
          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item name="reward_gold" label="金币奖励池" extra="按伤害比例分配">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="默认=等级×100" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="reward_exp" label="经验奖励池" extra="按伤害比例分配">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="默认=等级×50" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="reward_equipment_id" label="装备奖励" extra="留空则随机分配装备（必发）">
                <Select
                  placeholder="随机装备"
                  allowClear
                  options={equipmentList.map((e: any) => ({ label: `${e.rarity === 'legendary' ? '🌟' : e.rarity === 'epic' ? '💜' : e.rarity === 'rare' ? '💙' : '⚪'} ${e.name}`, value: e.id }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item name="max_questions_per_user" label="每人答题上限" extra="默认20题，0=不限" initialValue={20}>
                <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="20" />
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
        width={isMobile ? '95%' : 800}
        destroyOnHidden
      >
        {detailData && (
          <div>
            <Row gutter={[24, 16]} style={{ marginBottom: 16 }}>
              <Col xs={24} md={8} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: isMobile ? 48 : 64 }}>{detailData.boss.boss_icon || '👹'}</div>
                <h3>{detailData.boss.boss_name}</h3>
                <Tag color="red">Lv.{detailData.boss.boss_level}</Tag>
                <Tag color={statusConfig[detailData.boss.status]?.color}>
                  {statusConfig[detailData.boss.status]?.label || detailData.boss.status}
                </Tag>
              </Col>
              <Col xs={24} md={16}>
                <Descriptions column={isMobile ? 1 : 2} size="small" bordered>
                  <Descriptions.Item label="血量">{detailData.boss.current_hp}/{detailData.boss.boss_max_hp}</Descriptions.Item>
                  <Descriptions.Item label="总伤害">{detailData.boss.total_damage}</Descriptions.Item>
                  <Descriptions.Item label="参与人数">{detailData.boss.participant_count} / {detailData.boss.class_student_count || '?'}</Descriptions.Item>
                  <Descriptions.Item label="参与率">
                    <Progress
                      percent={detailData.boss.participation_rate || 0}
                      size="small"
                      style={{ width: 100, marginBottom: 0 }}
                      strokeColor={detailData.boss.participation_rate >= 80 ? '#52c41a' : detailData.boss.participation_rate >= 50 ? '#faad14' : '#f5222d'}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="平均正确率">{detailData.boss.avg_accuracy || 0}%</Descriptions.Item>
                  <Descriptions.Item label="知识点">{detailData.boss.knowledge_point || '-'}</Descriptions.Item>
                  <Descriptions.Item label="创建时间">{detailData.boss.created_at ? new Date(detailData.boss.created_at).toLocaleString() : '-'}</Descriptions.Item>
                  <Descriptions.Item label="截止时间">{detailData.boss.expires_at ? new Date(detailData.boss.expires_at).toLocaleString() : '-'}</Descriptions.Item>
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
              <Card title={`🏆 参赛排名（${detailData.participants.length}人）`} size="small" style={{ marginBottom: 16 }}>
                <Table
                  dataSource={detailData.participants}
                  columns={[
                    {
                      title: '排名',
                      key: 'rank',
                      width: 60,
                      render: (_: any, __: any, index: number) => {
                        if (index === 0) return <span style={{ fontSize: 18 }}>🥇</span>;
                        if (index === 1) return <span style={{ fontSize: 18 }}>🥈</span>;
                        if (index === 2) return <span style={{ fontSize: 18 }}>🥉</span>;
                        return <span style={{ color: '#999' }}>{index + 1}</span>;
                      },
                    },
                    {
                      title: '学生',
                      dataIndex: 'username',
                      key: 'username',
                      render: (name: string, record: any) => (
                        <span>{name}{record.pet_name ? <Tag style={{ marginLeft: 4, fontSize: 10 }}>{record.pet_name} Lv.{record.pet_level}</Tag> : null}</span>
                      ),
                    },
                    {
                      title: '伤害',
                      dataIndex: 'damage_dealt',
                      key: 'damage_dealt',
                      render: (dmg: number) => <Tag color="red">{dmg}</Tag>,
                    },
                    {
                      title: '答题',
                      key: 'answers',
                      responsive: ['sm'] as any,
                      render: (_: any, record: any) => `${record.correct_answers}/${record.total_attempts}`,
                    },
                    {
                      title: '正确率',
                      key: 'accuracy',
                      responsive: ['md'] as any,
                      render: (_: any, record: any) => {
                        const acc = record.total_attempts > 0 ? Math.round((record.correct_answers / record.total_attempts) * 100) : 0;
                        return <span style={{ color: acc >= 80 ? '#52c41a' : acc >= 60 ? '#faad14' : '#f5222d' }}>{acc}%</span>;
                      },
                    },
                  ]}
                  rowKey="user_id"
                  pagination={detailData.participants.length > 20 ? { pageSize: 20, showSizeChanger: true } : false}
                  size="small"
                />
              </Card>
            )}

            {detailData.non_participants && detailData.non_participants.length > 0 && (
              <Card title={`⚠️ 未参与学生（${detailData.non_participants.length}人）`} size="small" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {detailData.non_participants.map((s: any) => (
                    <Tag key={s.id} color="default">{s.username}</Tag>
                  ))}
                </div>
              </Card>
            )}

            {detailData.participants && detailData.participants.length === 0 && (
              <Empty description="暂无学生参与此BOSS战" style={{ marginTop: 16 }} />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default BossBattleManager;
