import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Drawer, Table, Tag, Select, Button, Space, Statistic, Row, Col, Empty, Input, Tooltip } from 'antd';
import { ReloadOutlined, HistoryOutlined } from '@ant-design/icons';
import { classroomQuizAPI, adminAPI } from '../utils/api';

/**
 * 课堂奖励发放日志
 *
 * 发奖记录一直写在 classroom_quiz_rewards 表里，但原先只能在「某一场课堂做题的详情」
 * 里看到那一场的记录——老师想查「这学期一共发了多少、发给谁、都是什么奖励」没有入口。
 * 这里补一个跨课堂的聚合视图，支持按班级、奖励类型、学生关键字筛。
 *
 * 权限：非管理员只能看自己任教班级（后端已限定），管理员可看全部。
 */

const REWARD_TYPES: Record<string, { label: string; color: string }> = {
  gold: { label: '金币', color: 'gold' },
  item: { label: '物品', color: 'green' },
  equipment: { label: '装备', color: 'blue' },
  exp: { label: '经验', color: 'purple' },
};

interface LogRow {
  id: number;
  student_name: string;
  pet_name?: string;
  reward_type: string;
  reward_value: string | number;
  reward_name?: string;
  reason?: string;
  awarder_name: string;
  awarded_at: string;
  quiz_title?: string;
  class_name?: string;
}

interface RewardLogDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 从某个课堂进来时预置筛选 */
  presetQuizId?: number | null;
  presetClassId?: number | null;
  presetStudentName?: string | null;
}

const RewardLogDrawer: React.FC<RewardLogDrawerProps> = ({
  open, onClose, presetQuizId, presetClassId, presetStudentName,
}) => {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [byType, setByType] = useState<{ type: string; count: number; total_value: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState<number | undefined>(presetClassId ?? undefined);
  const [rewardType, setRewardType] = useState<string | undefined>(undefined);
  const [keyword, setKeyword] = useState<string>(presetStudentName || '');

  // 打开时套用外部带入的筛选，并回到第 1 页
  useEffect(() => {
    if (!open) return;
    setClassId(presetClassId ?? undefined);
    setPage(1);
    setKeyword(presetStudentName || '');
  }, [open, presetClassId, presetStudentName]);

  useEffect(() => {
    if (!open) return;
    adminAPI.getClasses().then((res: any) => setClasses(res.data.classes || [])).catch(() => {});
  }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await classroomQuizAPI.getRewardLogs({
        class_id: classId,
        quiz_id: presetQuizId ?? undefined,
        reward_type: rewardType,
        page,
        pageSize,
      });
      setLogs(res.data.logs || []);
      setTotal(res.data.total || 0);
      setByType(res.data.byType || []);
    } catch (e) {
      setLogs([]);
      setTotal(0);
      setByType([]);
    } finally {
      setLoading(false);
    }
  }, [classId, presetQuizId, rewardType, page, pageSize]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // 关键字在前端过滤：后端按 student_id 精确查，而老师手上通常只有姓名
  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return logs;
    return logs.filter((r) =>
      (r.student_name || '').toLowerCase().includes(kw) ||
      (r.quiz_title || '').toLowerCase().includes(kw) ||
      (r.reward_name || '').toLowerCase().includes(kw) ||
      (r.reason || '').toLowerCase().includes(kw)
    );
  }, [logs, keyword]);

  const statOf = (type: string) => byType.find((b) => b.type === type);

  const columns = [
    {
      title: '时间', dataIndex: 'awarded_at', width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    { title: '班级', dataIndex: 'class_name', width: 120, render: (v: string) => v || '-' },
    { title: '学生', dataIndex: 'student_name', width: 100 },
    {
      title: '奖励', dataIndex: 'reward_type', width: 160,
      render: (t: string, r: LogRow) => (
        <span>
          <Tag color={REWARD_TYPES[t]?.color}>{REWARD_TYPES[t]?.label || t}</Tag>
          {r.reward_name || <span style={{ color: '#666' }}>{r.reward_value}</span>}
        </span>
      ),
    },
    { title: '课堂', dataIndex: 'quiz_title', ellipsis: true, render: (v: string) => v || '-' },
    { title: '原因', dataIndex: 'reason', ellipsis: true, render: (v: string) => v || '-' },
    { title: '发放者', dataIndex: 'awarder_name', width: 100 },
  ];

  return (
    <Drawer
      title={<><HistoryOutlined style={{ marginRight: 8 }} />课堂奖励发放记录</>}
      open={open}
      onClose={onClose}
      width={960}
      destroyOnHidden
    >
      {/* 顶部汇总：一眼看清发了多少，而不是要自己翻表数 */}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}><Statistic title="发放总笔数" value={total} suffix="笔" /></Col>
        <Col span={6}>
          <Statistic
            title="金币合计" value={statOf('gold')?.total_value || 0} suffix="金币"
            valueStyle={{ color: '#faad14' }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="物品发放" value={statOf('item')?.count || 0} suffix="次"
            valueStyle={{ color: '#52c41a' }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="经验合计" value={statOf('exp')?.total_value || 0} suffix="点"
            valueStyle={{ color: '#722ed1' }}
          />
        </Col>
      </Row>

      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear placeholder="全部班级" style={{ width: 160 }}
          value={classId}
          onChange={(v) => { setClassId(v); setPage(1); }}
          options={classes.map((c: any) => ({ value: c.id, label: c.name }))}
        />
        <Select
          allowClear placeholder="全部奖励类型" style={{ width: 140 }}
          value={rewardType}
          onChange={(v) => { setRewardType(v); setPage(1); }}
          options={Object.entries(REWARD_TYPES).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        <Input.Search
          allowClear placeholder="搜学生 / 课堂 / 奖励 / 原因" style={{ width: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
        </Tooltip>
      </Space>

      {presetQuizId ? (
        <div style={{ marginBottom: 8, fontSize: 12, color: '#888' }}>当前仅显示该场课堂做题的发放记录</div>
      ) : null}

      <Table
        dataSource={rows}
        columns={columns}
        rowKey="id"
        size="small"
        loading={loading}
        locale={{ emptyText: <Empty description="还没有课堂奖励发放记录" /> }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
      {keyword.trim() && rows.length !== logs.length ? (
        <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
          本页按关键字筛出 {rows.length} 条（关键字只匹配已加载的 {logs.length} 条，跨页请结合上方筛选条件）
        </div>
      ) : null}
    </Drawer>
  );
};

export default RewardLogDrawer;