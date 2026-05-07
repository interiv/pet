import React, { useEffect, useState } from 'react';
import {
  Card, Input, Button, Table, Tag, message, Typography, Space, Empty, Divider
} from 'antd';
import { GiftOutlined, HistoryOutlined, SearchOutlined } from '@ant-design/icons';
import { cardAPI } from '../utils/api';

const { Title, Text } = Typography;

const CARD_TYPES: Record<string, { label: string; color: string }> = {
  gold: { label: '金币卡', color: 'gold' },
  item: { label: '物品卡', color: 'green' },
  equipment: { label: '装备卡', color: 'blue' },
  exp: { label: '经验卡', color: 'orange' },
  mystery: { label: '神秘卡', color: 'purple' },
};

const CardRedeem: React.FC = () => {
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [lastRedeem, setLastRedeem] = useState<any>(null);

  useEffect(() => {
    loadLogs(1);
  }, []);

  const loadLogs = async (page: number) => {
    setLogsLoading(true);
    try {
      const res = await cardAPI.getRedemptionLogs({ page, pageSize: 10 });
      setLogs(res.data.logs || []);
      setLogsTotal(res.data.total || 0);
      setLogsPage(page);
    } catch (e) {
      console.error('加载兑换记录失败:', e);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleRedeem = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      message.warning('请输入卡号');
      return;
    }

    setRedeeming(true);
    try {
      const res = await cardAPI.redeemCard(trimmed);
      const card = res.data.card;
      setLastRedeem(card);
      message.success(`兑换成功！获得: ${card.reward_name || card.reward_type + ' x' + card.reward_value}`);
      setCode('');
      loadLogs(1);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '兑换失败，请检查卡号');
    } finally {
      setRedeeming(false);
    }
  };

  const logColumns = [
    {
      title: '卡号', dataIndex: 'code', key: 'code',
      render: (c: string) => <Text code>{c}</Text>
    },
    {
      title: '类型', dataIndex: 'type', key: 'type',
      render: (t: string) => <Tag color={CARD_TYPES[t]?.color}>{CARD_TYPES[t]?.label || t}</Tag>
    },
    {
      title: '奖励', key: 'reward',
      render: (_: any, r: any) => r.reward_name || `${r.reward_type} x${r.reward_value}`
    },
    {
      title: '兑换时间', dataIndex: 'redeemed_at', key: 'redeemed_at',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
  ];

  return (
    <div style={{ padding: 16, maxWidth: 800, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 24 }}>
        <GiftOutlined style={{ marginRight: 8 }} />
        卡兑换
      </Title>

      <Card style={{ marginBottom: 24, borderRadius: 12 }}>
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            输入老师发放的卡号，兑换奖励
          </Text>
          <Space.Compact style={{ width: '100%', maxWidth: 400 }}>
            <Input
              size="large"
              placeholder="请输入卡号"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onPressEnter={handleRedeem}
              prefix={<GiftOutlined />}
              style={{ fontFamily: 'Courier New, monospace', letterSpacing: 2 }}
              maxLength={20}
            />
            <Button
              type="primary"
              size="large"
              icon={<SearchOutlined />}
              loading={redeeming}
              onClick={handleRedeem}
            >
              兑换
            </Button>
          </Space.Compact>
        </div>

        {lastRedeem && (
          <div style={{
            marginTop: 16, padding: 16, background: '#f6ffed',
            borderRadius: 8, border: '1px solid #b7eb8f'
          }}>
            <Text strong style={{ color: '#52c41a' }}>最近兑换成功！</Text>
            <div style={{ marginTop: 8 }}>
              <Tag color={CARD_TYPES[lastRedeem.type]?.color}>{CARD_TYPES[lastRedeem.type]?.label}</Tag>
              <Text>获得: {lastRedeem.reward_name || `${lastRedeem.reward_type} x${lastRedeem.reward_value}`}</Text>
            </div>
          </div>
        )}
      </Card>

      <Divider />

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <HistoryOutlined style={{ marginRight: 8 }} />
        <Title level={5} style={{ margin: 0 }}>兑换记录</Title>
      </div>

      {logs.length === 0 && !logsLoading ? (
        <Empty description="暂无兑换记录" />
      ) : (
        <Table
          dataSource={logs}
          columns={logColumns}
          rowKey="id"
          loading={logsLoading}
          pagination={{
            current: logsPage,
            pageSize: 10,
            total: logsTotal,
            onChange: (p) => loadLogs(p),
            showTotal: (t) => `共 ${t} 条记录`
          }}
          size="middle"
        />
      )}
    </div>
  );
};

export default CardRedeem;
