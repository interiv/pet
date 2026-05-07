import React, { useEffect, useState, useRef } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, InputNumber,
  message, Space, Tag, Popconfirm, Descriptions, Divider, Row, Col, Typography
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, PrinterOutlined, EyeOutlined,
  CopyOutlined, StopOutlined
} from '@ant-design/icons';
import { cardAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

const { Text, Title } = Typography;

const CARD_TYPES: Record<string, { label: string; color: string }> = {
  gold: { label: '金币卡', color: 'gold' },
  item: { label: '物品卡', color: 'green' },
  equipment: { label: '装备卡', color: 'blue' },
  exp: { label: '经验卡', color: 'orange' },
  mystery: { label: '神秘卡', color: 'purple' },
};

const CardManager: React.FC = () => {
  const { currentClass } = useAuthStore();
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [batchCards, setBatchCards] = useState<any[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsTotal, setCardsTotal] = useState(0);
  const [cardsPage, setCardsPage] = useState(1);
  const [cardsFilter, setCardsFilter] = useState<string>('all');
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [codesModalOpen, setCodesModalOpen] = useState(false);
  const [form] = Form.useForm();
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBatches();
  }, []);

  const loadBatches = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (currentClass?.id) params.class_id = currentClass.id;
      const res = await cardAPI.getBatches(params);
      setBatches(res.data.batches || []);
    } catch (e) {
      console.error('加载批次失败:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (values: any) => {
    try {
      const data = {
        ...values,
        class_id: currentClass?.id || undefined,
      };
      const res = await cardAPI.createBatch(data);
      message.success(res.data.message);
      setGeneratedCodes(res.data.codes || []);
      setCodesModalOpen(true);
      setCreateModalOpen(false);
      form.resetFields();
      loadBatches();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '创建失败');
    }
  };

  const handleDeleteBatch = async (batchId: number) => {
    try {
      await cardAPI.deleteBatch(batchId);
      message.success('批次已删除');
      loadBatches();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败');
    }
  };

  const handleViewDetail = async (batch: any) => {
    setSelectedBatch(batch);
    setDetailModalOpen(true);
    setCardsPage(1);
    setCardsFilter('all');
    loadBatchCards(batch.id, 1, 'all');
  };

  const loadBatchCards = async (batchId: number, page: number, status: string) => {
    setCardsLoading(true);
    try {
      const params: any = { page, pageSize: 50 };
      if (status !== 'all') params.status = status;
      const res = await cardAPI.getBatchCards(batchId, params);
      setBatchCards(res.data.cards || []);
      setCardsTotal(res.data.total || 0);
    } catch (e) {
      console.error('加载卡列表失败:', e);
    } finally {
      setCardsLoading(false);
    }
  };

  const handleInvalidateCard = async (cardId: number) => {
    try {
      await cardAPI.invalidateCard(cardId);
      message.success('卡已作废');
      if (selectedBatch) {
        loadBatchCards(selectedBatch.id, cardsPage, cardsFilter);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '操作失败');
    }
  };

  const copyAllCodes = () => {
    const text = generatedCodes.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制全部卡号到剪贴板');
    }).catch(() => {
      message.info('请手动复制');
    });
  };

  const handlePrintCutLayout = () => {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;

    const cardsPerRow = 4;
    const rows: string[][] = [];
    for (let i = 0; i < generatedCodes.length; i += cardsPerRow) {
      rows.push(generatedCodes.slice(i, i + cardsPerRow));
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>卡号打印 - 裁切布局</title>
        <style>
          @page { size: A4; margin: 10mm; }
          body { font-family: 'Microsoft YaHei', sans-serif; margin: 0; padding: 0; }
          .page { page-break-after: always; }
          .page:last-child { page-break-after: auto; }
          .grid { display: flex; flex-wrap: wrap; gap: 4mm; justify-content: flex-start; }
          .card-item {
            width: 45mm; height: 25mm; border: 2px dashed #999;
            display: flex; flex-direction: column; align-items: center;
            justify-content: center; padding: 2mm; box-sizing: border-box;
            position: relative; background: #fff;
          }
          .card-code { font-size: 11px; font-weight: bold; font-family: 'Courier New', monospace; letter-spacing: 1px; }
          .card-type { font-size: 9px; color: #666; margin-top: 1mm; }
          .card-reward { font-size: 8px; color: #999; }
          .cut-line { border: 1px dashed #ccc; }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="text-align:center;padding:10px;">
          <button onclick="window.print()" style="padding:8px 20px;font-size:14px;cursor:pointer;">打印</button>
          <span style="margin-left:10px;color:#666;">沿虚线裁切每张卡片</span>
        </div>
        <div class="page">
          <div class="grid">
            ${rows.map(row => row.map(code => `
              <div class="card-item cut-line">
                <div class="card-code">${code}</div>
                <div class="card-type">${CARD_TYPES[selectedBatch?.type]?.label || '卡'}</div>
                <div class="card-reward">${selectedBatch?.reward_name || selectedBatch?.reward_type + ' x' + selectedBatch?.reward_value}</div>
              </div>
            `).join('')).join('')}
          </div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handlePrintBatchLayout = () => {
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>卡号打印 - 批量布局</title>
        <style>
          @page { size: A4; margin: 8mm; }
          body { font-family: 'Microsoft YaHei', sans-serif; margin: 0; padding: 0; }
          .page { page-break-after: always; }
          .page:last-child { page-break-after: auto; }
          .header { text-align: center; margin-bottom: 5mm; }
          .header h2 { margin: 0; font-size: 14px; }
          .header p { margin: 2mm 0; font-size: 10px; color: #666; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th, td { border: 1px solid #333; padding: 2mm 3mm; text-align: center; }
          th { background: #f0f0f0; font-weight: bold; }
          .used { color: #999; text-decoration: line-through; }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="text-align:center;padding:10px;">
          <button onclick="window.print()" style="padding:8px 20px;font-size:14px;cursor:pointer;">打印</button>
        </div>
        <div class="page">
          <div class="header">
            <h2>${selectedBatch?.name || '卡号列表'}</h2>
            <p>类型: ${CARD_TYPES[selectedBatch?.type]?.label || '-'} | 奖励: ${selectedBatch?.reward_name || selectedBatch?.reward_type + ' x' + selectedBatch?.reward_value} | 共 ${generatedCodes.length} 张</p>
          </div>
          <table>
            <thead>
              <tr><th>序号</th><th>卡号</th><th>类型</th><th>奖励</th><th>状态</th></tr>
            </thead>
            <tbody>
              ${generatedCodes.map((code, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td style="font-family:'Courier New',monospace;font-weight:bold;">${code}</td>
                  <td>${CARD_TYPES[selectedBatch?.type]?.label || '-'}</td>
                  <td>${selectedBatch?.reward_name || selectedBatch?.reward_type + ' x' + selectedBatch?.reward_value}</td>
                  <td>未使用</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  const batchColumns = [
    { title: '批次名称', dataIndex: 'name', key: 'name' },
    {
      title: '类型', dataIndex: 'type', key: 'type',
      render: (type: string) => <Tag color={CARD_TYPES[type]?.color}>{CARD_TYPES[type]?.label || type}</Tag>
    },
    { title: '奖励内容', key: 'reward', render: (_: any, r: any) => r.reward_name || `${r.reward_type} x${r.reward_value}` },
    { title: '总数', dataIndex: 'quantity', key: 'quantity' },
    {
      title: '使用情况', key: 'usage',
      render: (_: any, r: any) => `${r.used_cards || 0}/${r.total_cards || r.quantity}`
    },
    { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(r)}>详情</Button>
          <Popconfirm title="确定删除此批次？" onConfirm={() => handleDeleteBatch(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    },
  ];

  const cardColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    {
      title: '卡号', dataIndex: 'code', key: 'code',
      render: (code: string) => <Text code style={{ fontSize: 12 }}>{code}</Text>
    },
    {
      title: '状态', dataIndex: 'is_used', key: 'is_used',
      render: (used: number, r: any) => {
        if (!r.is_active) return <Tag color="default">已作废</Tag>;
        return used ? <Tag color="red">已使用</Tag> : <Tag color="green">未使用</Tag>;
      }
    },
    {
      title: '使用者', key: 'used_by_name',
      render: (_: any, r: any) => r.used_by_name || '-'
    },
    {
      title: '使用时间', dataIndex: 'used_at', key: 'used_at',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    {
      title: '操作', key: 'actions',
      render: (_: any, r: any) => {
        if (r.is_used || !r.is_active) return null;
        return (
          <Popconfirm title="确定作废此卡？" onConfirm={() => handleInvalidateCard(r.id)}>
            <Button type="link" size="small" danger icon={<StopOutlined />}>作废</Button>
          </Popconfirm>
        );
      }
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>卡管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          批量生成卡
        </Button>
      </div>

      <Table
        dataSource={batches}
        columns={batchColumns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 个批次` }}
        size="middle"
      />

      <Modal
        title="批量生成卡"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="批次名称" rules={[{ required: true, message: '请输入批次名称' }]}>
            <Input placeholder="如：期中考试奖励卡" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="type" label="卡类型" rules={[{ required: true }]}>
                <Select options={Object.entries(CARD_TYPES).map(([k, v]) => ({ value: k, label: v.label }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="quantity" label="生成数量" rules={[{ required: true }]}>
                <InputNumber min={1} max={500} style={{ width: '100%' }} placeholder="1-500" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="reward_type" label="奖励类型" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'gold', label: '金币' },
                  { value: 'item', label: '物品(ID)' },
                  { value: 'equipment', label: '装备(ID)' },
                  { value: 'exp', label: '经验值' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="reward_value" label="奖励数值" rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="数量/ID" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="reward_name" label="奖励名称（可选）">
            <Input placeholder="如：100金币、体力药剂" />
          </Form.Item>
          <Form.Item name="note" label="备注（可选）">
            <Input.TextArea rows={2} placeholder="内部备注" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="生成的卡号"
        open={codesModalOpen}
        onCancel={() => setCodesModalOpen(false)}
        footer={[
          <Button key="copy" icon={<CopyOutlined />} onClick={copyAllCodes}>复制全部</Button>,
          <Button key="print-cut" icon={<PrinterOutlined />} onClick={handlePrintCutLayout}>裁切布局打印</Button>,
          <Button key="print-batch" icon={<PrinterOutlined />} onClick={handlePrintBatchLayout}>批量布局打印</Button>,
          <Button key="close" type="primary" onClick={() => setCodesModalOpen(false)}>关闭</Button>,
        ]}
        width={700}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">共生成 {generatedCodes.length} 张卡，请妥善保管卡号：</Text>
        </div>
        <div style={{
          maxHeight: 400, overflow: 'auto', background: '#f5f5f5',
          padding: 12, borderRadius: 6, fontFamily: 'Courier New, monospace',
          fontSize: 13, lineHeight: 2
        }}>
          {generatedCodes.map((code, i) => (
            <div key={i}>
              <span style={{ color: '#999', marginRight: 8 }}>{i + 1}.</span>
              {code}
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        title={`批次详情: ${selectedBatch?.name || ''}`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={900}
      >
        {selectedBatch && (
          <>
            <Descriptions size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="类型">
                <Tag color={CARD_TYPES[selectedBatch.type]?.color}>{CARD_TYPES[selectedBatch.type]?.label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="奖励">{selectedBatch.reward_name || `${selectedBatch.reward_type} x${selectedBatch.reward_value}`}</Descriptions.Item>
              <Descriptions.Item label="总数">{selectedBatch.quantity}</Descriptions.Item>
              <Descriptions.Item label="备注">{selectedBatch.note || '-'}</Descriptions.Item>
              <Descriptions.Item label="创建者">{selectedBatch.creator_name}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{new Date(selectedBatch.created_at).toLocaleString('zh-CN')}</Descriptions.Item>
            </Descriptions>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ marginBottom: 12 }}>
              <Select
                value={cardsFilter}
                onChange={(v) => { setCardsFilter(v); setCardsPage(1); loadBatchCards(selectedBatch.id, 1, v); }}
                style={{ width: 120 }}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'unused', label: '未使用' },
                  { value: 'used', label: '已使用' },
                ]}
              />
            </div>
            <Table
              dataSource={batchCards}
              columns={cardColumns}
              rowKey="id"
              loading={cardsLoading}
              pagination={{
                current: cardsPage,
                pageSize: 50,
                total: cardsTotal,
                onChange: (p) => { setCardsPage(p); loadBatchCards(selectedBatch.id, p, cardsFilter); },
                showTotal: (t) => `共 ${t} 张卡`
              }}
              size="small"
            />
          </>
        )}
      </Modal>

      <div ref={printRef} style={{ display: 'none' }} />
    </div>
  );
};

export default CardManager;
