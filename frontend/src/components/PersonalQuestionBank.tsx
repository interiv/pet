import React, { useEffect, useMemo, useState } from 'react';
import {
  Card, Row, Col, Statistic, Tag, Select, Input, Empty, Spin, message, Button, Pagination, Progress, Popconfirm, Space, Alert,
} from 'antd';
import { DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { assignmentAPI } from '../utils/api';
import { questionTypeLabel } from '../utils/questionTypes';

// 题型标签统一取自 utils/questionTypes，本文件不再维护副本

const ASSIGNMENT_TYPE_LABEL: Record<string, { text: string; color: string }> = {
  preview: { text: '预习', color: 'purple' },
  homework: { text: '作业', color: 'blue' },
  review: { text: '复习', color: 'orange' },
};

interface BankItem {
  id: number;
  question_id: number;
  question_content: string;
  options?: string[] | null;
  correct_answer?: string;
  question_type: string;
  subject?: string;
  knowledge_point?: string;
  assignment_title?: string;
  assignment_type?: string;
  first_answer?: string;
  last_answer?: string;
  is_correct: number;
  attempt_count: number;
  correct_count: number;
  source?: string;
  explanation?: string;
  analysis?: string;
  updated_at?: string;
}

const PersonalQuestionBank: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BankItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [subject, setSubject] = useState<string | undefined>(undefined);
  const [assignmentType, setAssignmentType] = useState<string | undefined>(undefined);
  const [onlyWrong, setOnlyWrong] = useState<boolean>(false);
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const loadList = async () => {
    setLoading(true);
    try {
      const res = await assignmentAPI.getMyPersonalBank({
        subject,
        assignment_type: assignmentType,
        only_wrong: onlyWrong ? 1 : 0,
        keyword: keyword || undefined,
        page,
        page_size: pageSize,
      });
      setItems(res.data.questions || []);
      setTotal(res.data.total || 0);
    } catch (e) {
      message.error('加载个人题库失败');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await assignmentAPI.getPersonalBankStats();
      setStats(res.data);
    } catch (e) {
      /* 统计失败不影响列表 */
    }
  };

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, subject, assignmentType, onlyWrong]);

  const subjectOptions = useMemo(() => {
    const set = new Set<string>();
    (stats?.by_subject || []).forEach((s: any) => set.add(s.subject));
    return [...set].filter(Boolean);
  }, [stats]);

  const handleRemove = async (id: number) => {
    try {
      await assignmentAPI.removeFromPersonalBank(id);
      message.success('已从个人题库移除');
      loadList();
      loadStats();
    } catch (e) {
      message.error('移除失败');
    }
  };

  const accuracy = stats?.accuracy ?? 0;

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="个人题库"
        description="每次作答（线上提交或老师登记的纸质作业）都会自动沉淀到这里，包含做对和做错的题；只做错的题在「错题本」里。"
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small"><Statistic title="累计题目" value={stats?.total || 0} suffix="题" /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small"><Statistic title="答对" value={stats?.correct || 0} valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small"><Statistic title="答错" value={stats?.wrong || 0} valueStyle={{ color: '#ff4d4f' }} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="正确率" value={accuracy} suffix="%" valueStyle={{ color: accuracy >= 80 ? '#52c41a' : '#faad14' }} />
          </Card>
        </Col>
      </Row>

      {stats?.by_type && stats.by_type.filter((t: any) => t.total > 0).length > 0 && (
        <Card size="small" title="按类型分布" style={{ marginBottom: 16 }}>
          <Row gutter={[16, 8]}>
            {stats.by_type.filter((t: any) => t.total > 0).map((t: any) => (
              <Col xs={24} sm={8} key={t.assignment_type}>
                <div style={{ fontSize: 13, marginBottom: 2 }}>
                  {t.label}：{t.total} 题　正确率 {t.accuracy}%
                </div>
                <Progress percent={t.accuracy} size="small" />
              </Col>
            ))}
          </Row>
        </Card>
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            placeholder="科目"
            allowClear
            style={{ width: 120 }}
            value={subject}
            onChange={(v) => { setSubject(v); setPage(1); }}
            options={subjectOptions.map(s => ({ value: s, label: s }))}
          />
          <Select
            placeholder="类型"
            allowClear
            style={{ width: 120 }}
            value={assignmentType}
            onChange={(v) => { setAssignmentType(v); setPage(1); }}
            options={[
              { value: 'preview', label: '预习' },
              { value: 'homework', label: '作业' },
              { value: 'review', label: '复习' },
            ]}
          />
          <Select
            style={{ width: 130 }}
            value={onlyWrong ? 'wrong' : 'all'}
            onChange={(v) => { setOnlyWrong(v === 'wrong'); setPage(1); }}
            options={[
              { value: 'all', label: '全部题目' },
              { value: 'wrong', label: '仅看答错' },
            ]}
          />
          <Input
            placeholder="搜题目内容 / 知识点"
            prefix={<SearchOutlined style={{ color: '#999' }} />}
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => { setPage(1); loadList(); }}
            allowClear
          />
          <Button onClick={() => { setPage(1); loadList(); }}>搜索</Button>
        </Space>
      </Card>

      <Spin spinning={loading}>
        {items.length === 0 ? (
          <Empty description="还没有做过题目，完成作业或个人库收录后会显示在这里" />
        ) : (
          <>
            {items.map((it, idx) => {
              const open = !!expanded[it.id];
              const typeInfo = ASSIGNMENT_TYPE_LABEL[it.assignment_type || 'homework'] || ASSIGNMENT_TYPE_LABEL.homework;
              return (
                <Card
                  key={it.id}
                  size="small"
                  style={{ marginBottom: 10 }}
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ color: '#888' }}>#{(page - 1) * pageSize + idx + 1}</span>
                      <Tag>{questionTypeLabel(it.question_type)}</Tag>
                      <Tag color={typeInfo.color}>{typeInfo.text}</Tag>
                      {it.subject && <Tag color="cyan">{it.subject}</Tag>}
                      <Tag color={it.is_correct ? 'green' : 'red'}>{it.is_correct ? '答对' : '答错'}</Tag>
                      {it.source === 'paper' && <Tag color="gold">纸质</Tag>}
                      {it.knowledge_point && <Tag color="geekblue">{it.knowledge_point}</Tag>}
                    </div>
                  }
                  extra={
                    <Space size={4}>
                      <Button size="small" type="link" onClick={() => setExpanded(prev => ({ ...prev, [it.id]: !open }))}>
                        {open ? '收起' : '查看答案'}
                      </Button>
                      <Popconfirm title="从个人题库移除这道题？" onConfirm={() => handleRemove(it.id)}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  }
                >
                  <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{it.question_content}</div>

                  {Array.isArray(it.options) && it.options.length > 0 && (
                    <div style={{ marginTop: 8, color: '#555', fontSize: 13 }}>
                      {it.options.map((o: string, i: number) => (
                        <div key={i}>{String.fromCharCode(65 + i)}. {o}</div>
                      ))}
                    </div>
                  )}

                  {open && (
                    <div style={{ marginTop: 10, borderTop: '1px dashed #eee', paddingTop: 8, fontSize: 13 }}>
                      <div>正确答案：<span style={{ color: '#52c41a', fontWeight: 500 }}>{it.correct_answer || '-'}</span></div>
                      <div style={{ color: '#888' }}>我的作答：{it.last_answer || '(空)'}</div>
                      {it.analysis && <div style={{ marginTop: 4, color: '#666', whiteSpace: 'pre-wrap' }}>解析：{it.analysis}</div>}
                      {it.explanation && <div style={{ marginTop: 4, color: '#666', whiteSpace: 'pre-wrap' }}>说明：{it.explanation}</div>}
                      <div style={{ marginTop: 4, color: '#aaa', fontSize: 12 }}>
                        来源：{it.assignment_title || '未知作业'}　作答 {it.attempt_count} 次，答对 {it.correct_count} 次
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Pagination
                current={page}
                pageSize={pageSize}
                total={total}
                onChange={(p, ps) => { setPage(p); setPageSize(ps); }}
                showSizeChanger
                pageSizeOptions={[10, 20, 50]}
              />
            </div>
          </>
        )}
      </Spin>
    </div>
  );
};

export default PersonalQuestionBank;
