import React, { useCallback, useEffect, useState } from 'react';
import { Drawer, Table, Tag, Segmented, Empty, Spin, Statistic, Typography, message } from 'antd';
import {
  DollarOutlined, GiftOutlined, ShoppingOutlined, TrophyOutlined, RiseOutlined, FallOutlined,
} from '@ant-design/icons';
import { userAPI } from '../utils/api';

const { Text } = Typography;

const KIND_COLOR: Record<string, string> = {
  gold: 'gold',
  item: 'blue',
  equipment: 'purple',
  skill: 'cyan',
};

/**
 * 我的资产明细：金币收支 + 道具/装备/技能的获得与消耗
 * 数据来自 GET /users/me/transactions（后端把两类流水合并成统一列表）
 */
const TransactionDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [type, setType] = useState<'all' | 'gold' | 'item'>('all');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await userAPI.getMyTransactions({ type, page, pageSize });
      setData(res.data);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载明细失败');
    } finally {
      setLoading(false);
    }
  }, [type, page, pageSize]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    setPage(1);
  }, [type]);

  const rows = data?.transactions || [];
  const s = data?.summary || {};

  return (
    <Drawer
      title="我的资产明细"
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      extra={
        <Segmented
          size="small"
          value={type}
          onChange={(v) => setType(v as 'all' | 'gold' | 'item')}
          options={[
            { label: '全部', value: 'all' },
            { label: '金币', value: 'gold' },
            { label: '物品', value: 'item' },
          ]}
        />
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Statistic
          title="当前金币"
          value={s.gold || 0}
          prefix={<DollarOutlined />}
          valueStyle={{ color: '#faad14', fontSize: 20 }}
        />
        <Statistic
          title="累计获得"
          value={s.totalGoldEarned || 0}
          prefix={<TrophyOutlined />}
          valueStyle={{ color: '#52c41a', fontSize: 20 }}
        />
        <Statistic
          title="流水收入（金币）"
          value={s.goldIn || 0}
          prefix={<RiseOutlined />}
          valueStyle={{ color: '#52c41a', fontSize: 18 }}
        />
        <Statistic
          title="流水支出（金币）"
          value={s.goldOut || 0}
          prefix={<FallOutlined />}
          valueStyle={{ color: '#ff4d4f', fontSize: 18 }}
        />
        <Statistic
          title="道具获得"
          value={s.itemIn || 0}
          prefix={<GiftOutlined />}
          valueStyle={{ color: '#1677ff', fontSize: 18 }}
        />
        <Statistic
          title="道具消耗"
          value={s.itemOut || 0}
          prefix={<ShoppingOutlined />}
          valueStyle={{ color: '#722ed1', fontSize: 18 }}
        />
      </div>

      <Spin spinning={loading}>
        <Table
          size="small"
          rowKey={(r: any, i?: number) => `${r.kind}-${i}`}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize,
            total: data?.total || 0,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            showSizeChanger: true,
          }}
          locale={{ emptyText: <Empty description="还没有任何资产变动记录" /> }}
          columns={[
            {
              title: '类型',
              dataIndex: 'kindLabel',
              key: 'kindLabel',
              width: 70,
              render: (v: string, r: any) => <Tag color={KIND_COLOR[r.kind] || 'default'}>{v}</Tag>,
            },
            {
              title: '变动',
              key: 'amount',
              width: 90,
              render: (_: any, r: any) => (
                <Text style={{ color: r.amount > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
                  {r.amount > 0 ? '+' : ''}{r.amount}
                  {r.kind === 'gold' ? ' 金币' : ' 个'}
                </Text>
              ),
            },
            {
              title: '说明',
              key: 'reason',
              render: (_: any, r: any) => (
                <div style={{ fontSize: 12 }}>
                  <div>{r.reason || <Text type="secondary">-</Text>}</div>
                  {r.name && <div style={{ color: '#999' }}>{r.name}</div>}
                </div>
              ),
            },
            {
              title: '来源',
              dataIndex: 'sourceLabel',
              key: 'source',
              width: 80,
              render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
            },
            {
              title: '时间',
              dataIndex: 'created_at',
              key: 'created_at',
              width: 110,
              render: (v: string) => (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {v ? String(v).replace('T', ' ').slice(0, 16) : '-'}
                </Text>
              ),
            },
          ]}
        />
      </Spin>
    </Drawer>
  );
};

export { TransactionDrawer };
export default TransactionDrawer;
