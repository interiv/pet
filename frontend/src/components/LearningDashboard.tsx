import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Progress, Select, DatePicker, Empty, Spin, Alert } from 'antd';
import {
  BookOutlined,
  TrophyOutlined,
  RiseOutlined,
  FallOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000/api';

interface KnowledgePointStat {
  knowledge_point: string;
  total_attempts: number;
  correct_attempts: number;
  accuracy: number;
}

interface KnowledgePointData {
  days: number;
  start_date: string;
  stats: KnowledgePointStat[];
  total_points: number;
  avg_accuracy: number;
}

interface WeakPointData {
  weak_points: KnowledgePointStat[];
  count: number;
  days: number;
  threshold: number;
}

const LearningDashboard: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [kpData, setKpData] = useState<KnowledgePointData | null>(null);
  const [weakPoints, setWeakPoints] = useState<WeakPointData | null>(null);

  useEffect(() => {
    loadData();
  }, [days]);

  const loadData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      // 加载知识点统计
      const [kpRes, weakRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/knowledge-points?days=${days}`, { headers }),
        axios.get(`${API_BASE_URL}/knowledge-points/weak-points?days=${days}`, { headers })
      ]);

      setKpData(kpRes.data);
      setWeakPoints(weakRes.data);
    } catch (error: any) {
      console.error('加载学习数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 90) return '#52c41a';
    if (accuracy >= 70) return '#faad14';
    if (accuracy >= 60) return '#fa8c16';
    return '#f5222d';
  };

  const getAccuracyStatus = (accuracy: number) => {
    if (accuracy >= 90) return '优秀';
    if (accuracy >= 70) return '良好';
    if (accuracy >= 60) return '及格';
    return '需加强';
  };

  const columns = [
    {
      title: '知识点',
      dataIndex: 'knowledge_point',
      key: 'knowledge_point',
      render: (text: string) => (
        <span style={{ fontWeight: 500 }}>
          <BookOutlined style={{ marginRight: 8, color: '#1890ff' }} />
          {text}
        </span>
      )
    },
    {
      title: '练习次数',
      dataIndex: 'total_attempts',
      key: 'total_attempts',
      sorter: (a: KnowledgePointStat, b: KnowledgePointStat) => a.total_attempts - b.total_attempts,
      render: (count: number) => (
        <Tag color="blue">{count} 次</Tag>
      )
    },
    {
      title: '正确次数',
      dataIndex: 'correct_attempts',
      key: 'correct_attempts',
      render: (correct: number, record: KnowledgePointStat) => (
        <span>
          <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
          {correct} / {record.total_attempts}
        </span>
      )
    },
    {
      title: '正确率',
      dataIndex: 'accuracy',
      key: 'accuracy',
      sorter: (a: KnowledgePointStat, b: KnowledgePointStat) => a.accuracy - b.accuracy,
      render: (accuracy: number) => (
        <div>
          <Progress
            percent={accuracy}
            size="small"
            strokeColor={getAccuracyColor(accuracy)}
            format={() => `${accuracy}%`}
          />
        </div>
      )
    },
    {
      title: '掌握程度',
      key: 'level',
      render: (_: any, record: KnowledgePointStat) => (
        <Tag color={getAccuracyColor(record.accuracy)}>
          {getAccuracyStatus(record.accuracy)}
        </Tag>
      )
    }
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#999' }}>加载学习数据中...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <RiseOutlined style={{ color: '#52c41a', fontSize: 28 }} />
            学习数据仪表盘
          </h2>
          <p style={{ color: '#666', margin: '8px 0 0' }}>
            查看你的学习进度和知识点掌握情况
          </p>
        </div>
        <Select
          value={days}
          onChange={setDays}
          style={{ width: 150 }}
          options={[
            { label: '最近7天', value: 7 },
            { label: '最近14天', value: 14 },
            { label: '最近30天', value: 30 }
          ]}
        />
      </div>

      {!kpData || kpData.stats.length === 0 ? (
        <Empty
          description="暂无学习数据，开始做题吧！"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <>
          {/* 统计卡片 */}
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="知识点总数"
                  value={kpData.total_points}
                  suffix="个"
                  prefix={<BookOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="平均正确率"
                  value={kpData.avg_accuracy}
                  suffix="%"
                  precision={2}
                  prefix={<TrophyOutlined />}
                  valueStyle={{ color: getAccuracyColor(kpData.avg_accuracy) }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="薄弱知识点"
                  value={weakPoints?.count || 0}
                  suffix="个"
                  prefix={<WarningOutlined />}
                  valueStyle={{ color: (weakPoints?.count || 0) > 0 ? '#f5222d' : '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="统计周期"
                  value={days}
                  suffix="天"
                  prefix={<RiseOutlined />}
                  valueStyle={{ color: '#722ed1' }}
                />
              </Card>
            </Col>
          </Row>

          {/* 薄弱知识点警告 */}
          {weakPoints && weakPoints.count > 0 && (
            <Alert
              type="warning"
              message={
                <span>
                  <WarningOutlined style={{ marginRight: 8 }} />
                  发现 {weakPoints.count} 个薄弱知识点，需要重点复习！
                </span>
              }
              description={
                <div style={{ marginTop: 8 }}>
                  {weakPoints.weak_points.slice(0, 3).map((wp, idx) => (
                    <div key={idx} style={{ marginBottom: 4 }}>
                      • <strong>{wp.knowledge_point}</strong>: 正确率 {wp.accuracy}% 
                      ({wp.correct_attempts}/{wp.total_attempts})
                    </div>
                  ))}
                  {weakPoints.count > 3 && (
                    <div style={{ color: '#999', marginTop: 4 }}>
                      还有 {weakPoints.count - 3} 个薄弱知识点...
                    </div>
                  )}
                </div>
              }
              showIcon={false}
              style={{ marginBottom: 16 }}
            />
          )}

          {/* 知识点详细表格 */}
          <Card title="知识点掌握情况" size="small">
            <Table
              dataSource={kpData.stats}
              columns={columns}
              rowKey="knowledge_point"
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Card>

          {/* 学习建议 */}
          <Card title="💡 学习建议" size="small" style={{ marginTop: 16 }}>
            <div style={{ lineHeight: 1.8, color: '#666' }}>
              {kpData.avg_accuracy && kpData.avg_accuracy >= 80 ? (
                <p>🎉 你的整体表现很优秀！继续保持，挑战更高难度的题目吧！</p>
              ) : kpData.avg_accuracy && kpData.avg_accuracy >= 60 ? (
                <p>👍 表现不错！重点复习薄弱知识点，可以进一步提升成绩。</p>
              ) : (
                <p>💪 需要加油！建议先巩固基础知识点，再逐步提升难度。</p>
              )}
              
              {weakPoints && weakPoints.count > 0 && (
                <div style={{ marginTop: 12, padding: '12px', background: '#fff7e6', borderRadius: 4 }}>
                  <strong>📌 建议复习顺序：</strong>
                  <ol style={{ marginTop: 8, paddingLeft: 20 }}>
                    {weakPoints.weak_points.slice(0, 5).map((wp, idx) => (
                      <li key={idx}>
                        {wp.knowledge_point} (正确率 {wp.accuracy}%)
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default LearningDashboard;
