import React, { useCallback, useEffect, useState } from 'react';
import { Table, Tag, Segmented, Empty, Spin, Statistic, Typography, Card, Progress } from 'antd';
import {
  DollarOutlined, ShoppingOutlined, TrophyOutlined, RiseOutlined, FallOutlined, WalletOutlined,
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
 * 我的资产明细（个人中心 → 资产明细）
 *
 * 为什么放在个人中心而不是右上角弹窗：
 *   1. 流水条目多，弹窗要滚动两层，手机上体验很差；
 *   2. 个人中心是「我的账号」归属地，资产明细和改密码放在一起更符合直觉；
 *   3. 只有学生会用到（教师/管理员没有金币与背包体系），所以仅学生可见。
 */
const TransactionPanel: React.FC = () => {
  const [type, setType] = useState<'all' | 'gold' | 'item'>('all');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const res = await userAPI.getMyTransactions({ type, page, pageSize });
      setData(res.data);
    } catch (e: any) {
      // 之前只 console，接口挂了与「没有流水」在界面上一样，会误判成功能坏掉
      setFailed(e?.response?.data?.error || '资产明细加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [type, page, pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [type]);

  const rows = data?.transactions || [];
  const s = data?.summary || {};
  // 收入/支出占比，用于给一个直观条形（纯展示，避免"看不懂钱去哪了"）
  const goldTotal = (s.goldIn || 0) + (s.goldOut || 0);
  const goldInPercent = goldTotal > 0 ? Math.round(((s.goldIn || 0) / goldTotal) * 100) : 0;

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16, background: 'linear-gradient(135deg, #fff7e6 0%, #ffe7ba 100%)', borderColor: '#ffd591' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <Statistic
            title="当前金币"
            value={s.gold || 0}
            prefix={<DollarOutlined />}
            valueStyle={{ color: '#fa8c16', fontSize: 22 }}
          />
          <Statistic
            title="累计获得（生涯）"
            value={s.totalGoldEarned || 0}
            prefix={<TrophyOutlined />}
            valueStyle={{ color: '#52c41a', fontSize: 22 }}
          />
          <Statistic
            title="道具净变化"
            value={(s.itemIn || 0) - (s.itemOut || 0)}
            prefix={<WalletOutlined />}
            valueStyle={{ fontSize: 22, color: (s.itemIn || 0) - (s.itemOut || 0) >= 0 ? '#52c41a' : '#ff4d4f' }}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            金币流水：收入 {s.goldIn || 0} · 支出 {s.goldOut || 0}
          </Text>
          <Progress
            percent={goldInPercent}
            size="small"
            strokeColor="#52c41a"
            trailColor="#ff7875"
            format={() => `支出占 ${100 - goldInPercent}%`}
          />
        </div>
      </Card>

      <div style={{ marginBottom: 12 }}>
        <Segmented
          value={type}
          onChange={(v) => setType(v as 'all' | 'gold' | 'item')}
          options={[
            { label: '全部', value: 'all' },
            { label: '金币', value: 'gold' },
            { label: '道具/装备', value: 'item' },
          ]}
        />
      </div>

      {failed && (
        <Card size="small" style={{ marginBottom: 12, borderColor: '#ffccc7', background: '#fff2f0' }}>
          <Text type="danger">{failed}</Text>
          <a onClick={load} style={{ marginLeft: 8 }}>重新加载</a>
        </Card>
      )}

      <Spin spinning={loading}>
        <Table
          size="small"
          rowKey={(r: any, i?: number) => `${r.kind}-${i}`}
          dataSource={rows}
          scroll={{ x: 520 }}
          pagination={{
            current: page,
            pageSize,
            total: data?.total || 0,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            showSizeChanger: false,
            hideOnSinglePage: true,
          }}
          locale={{ emptyText: <Empty description="还没有资产变动记录（完成作业、登录、投喂宠物后就会有）" /> }}
          columns={[
            {
              title: '类型',
              dataIndex: 'kindLabel',
              key: 'kindLabel',
              width: 72,
              render: (v: string, r: any) => <Tag color={KIND_COLOR[r.kind] || 'default'}>{v}</Tag>,
            },
            {
              title: '变动',
              key: 'amount',
              width: 96,
              render: (_: any, r: any) => (
                <Text style={{ color: r.amount > 0 ? '#389e0d' : '#cf1322', fontWeight: 600 }}>
                  {r.amount > 0 ? '+' : ''}{r.amount}{r.kind === 'gold' ? ' 金币' : ''}
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
              width: 84,
              render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
            },
            {
              title: '时间',
              dataIndex: 'created_at',
              key: 'created_at',
              width: 108,
              render: (v: string) => (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {v ? String(v).replace('T', ' ').slice(5, 16) : '-'}
                </Text>
              ),
            },
          ]}
        />
      </Spin>

      <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
        <RiseOutlined style={{ color: '#52c41a' }} /> 绿色为收入 / 获得，
        <FallOutlined style={{ color: '#ff4d4f', marginLeft: 8 }} /> 红色为支出 / 消耗。
        <ShoppingOutlined style={{ marginLeft: 8 }} /> 商店买道具、装备买卖、强化与技能升级、投喂与复活宠物等都会记流水。
      </div>
    </div>
  );
};

export { TransactionPanel };
export default TransactionPanel;
