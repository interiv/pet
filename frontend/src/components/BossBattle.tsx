import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Card, Progress, Button, List, Avatar, Tag, message, Statistic, Row, Col, Badge, Empty, Spin, Modal, Radio, Input } from 'antd';
import {
  ThunderboltOutlined,
  TeamOutlined,
  FireOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000/api';

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};

interface BossQuestion {
  question_id: number;
  content: string;
  type: string;
  difficulty: string;
  options: string[] | null;
  hint: string | null;
}

interface LeaderboardItem {
  user_id: number;
  username: string;
  pet_name: string;
  pet_level: number;
  damage_dealt: number;
  correct_answers: number;
  total_attempts: number;
}

const BossBattle: React.FC = () => {
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [loading, setLoading] = useState(false);
  const [bossData, setBossData] = useState<any>(null);

  // 答题Modal状态
  const [quizModalVisible, setQuizModalVisible] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<BossQuestion | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [questionLoading, setQuestionLoading] = useState(false);

  // 攻击结果
  const [attackResult, setAttackResult] = useState<any>(null);
  const [resultVisible, setResultVisible] = useState(false);

  // 冷却计时器
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (user?.class_id) {
      loadBoss();
    }
  }, [user]);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
      }
    };
  }, []);

  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
    }
    cooldownTimerRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) {
            clearInterval(cooldownTimerRef.current);
            cooldownTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const loadBoss = async () => {
    if (!user?.class_id) return;

    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_BASE_URL}/boss-battles/current/${user.class_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBossData(response.data);
    } catch (error: any) {
      console.error('加载BOSS失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 点击攻击 -> 先获取题目
  const handleAttackClick = async () => {
    if (!bossData?.boss || cooldown > 0) return;

    try {
      setQuestionLoading(true);
      const token = localStorage.getItem('token');
      const response = await axios.get(
        `${API_BASE_URL}/boss-battles/${bossData.boss.id}/question`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setCurrentQuestion(response.data);
      setSelectedAnswer('');
      setAttackResult(null);
      setQuizModalVisible(true);
    } catch (error: any) {
      message.error(error.response?.data?.error || '获取题目失败');
    } finally {
      setQuestionLoading(false);
    }
  };

  // 提交答案
  const handleSubmitAnswer = async () => {
    if (!currentQuestion || !selectedAnswer) {
      message.warning('请先选择答案');
      return;
    }

    try {
      setSubmitting(true);
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/boss-battles/${bossData.boss.id}/attack`,
        {
          question_id: currentQuestion.question_id,
          answer: selectedAnswer
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setAttackResult(response.data);
      setQuizModalVisible(false);
      setResultVisible(true);

      // 启动30秒冷却
      startCooldown(30);

      if (response.data.boss_defeated) {
        message.success('🎉 恭喜!BOSS被击败了!');
      }

      loadBoss();
    } catch (error: any) {
      if (error.response?.status === 429) {
        const remaining = error.response.data.cooldown_remaining || 30;
        startCooldown(remaining);
        message.warning(error.response.data.error);
        setQuizModalVisible(false);
      } else {
        message.error(error.response?.data?.error || '攻击失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 渲染题目选项
  const renderOptions = () => {
    if (!currentQuestion) return null;

    const { type, options } = currentQuestion;

    if (type === 'judgment') {
      return (
        <Radio.Group
          value={selectedAnswer}
          onChange={e => setSelectedAnswer(e.target.value)}
          style={{ width: '100%' }}
        >
          <Radio.Button value="A" style={{ width: '50%', textAlign: 'center', height: 48, lineHeight: '48px' }}>
            ✅ 正确
          </Radio.Button>
          <Radio.Button value="B" style={{ width: '50%', textAlign: 'center', height: 48, lineHeight: '48px' }}>
            ❌ 错误
          </Radio.Button>
        </Radio.Group>
      );
    }

    if (type === 'fill_blank') {
      return (
        <Input
          placeholder="请输入答案"
          value={selectedAnswer}
          onChange={e => setSelectedAnswer(e.target.value)}
          onPressEnter={handleSubmitAnswer}
          size="large"
        />
      );
    }

    if (options && Array.isArray(options)) {
      const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
      return (
        <Radio.Group
          value={selectedAnswer}
          onChange={e => setSelectedAnswer(e.target.value)}
          style={{ width: '100%' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {options.map((opt: string, idx: number) => (
              <Radio.Button
                key={idx}
                value={labels[idx]}
                style={{
                  height: 'auto',
                  padding: '12px 16px',
                  textAlign: 'left',
                  whiteSpace: 'normal',
                  lineHeight: 1.5
                }}
              >
                <strong>{labels[idx]}.</strong> {opt}
              </Radio.Button>
            ))}
          </div>
        </Radio.Group>
      );
    }

    return <div style={{ color: '#999' }}>无法渲染此题型</div>;
  };

  // 渲染难度标签
  const renderDifficultyTag = (difficulty: string) => {
    const config: Record<string, { color: string; text: string }> = {
      easy: { color: 'green', text: '简单' },
      medium: { color: 'orange', text: '中等' },
      hard: { color: 'red', text: '困难' }
    };
    const d = config[difficulty] || config.medium;
    return <Tag color={d.color}>{d.text}</Tag>;
  };

  // 渲染题型标签
  const renderTypeTag = (type: string) => {
    const config: Record<string, string> = {
      choice_single: '单选题',
      choice_multi: '多选题',
      judgment: '判断题',
      fill_blank: '填空题'
    };
    return <Tag>{config[type] || type}</Tag>;
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: '#999' }}>加载BOSS信息中...</div>
      </div>
    );
  }

  if (!bossData?.boss) {
    return (
      <div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FireOutlined style={{ color: '#f5222d', fontSize: 28 }} />
          班级BOSS战
        </h2>
        <Empty
          description="当前没有活跃的BOSS，等待教师创建或从错题生成"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ marginTop: 40 }}
        />
      </div>
    );
  }

  const boss = bossData.boss;
  const timeLeft = Math.max(0, Math.floor((new Date(boss.expires_at).getTime() - Date.now()) / (1000 * 60 * 60)));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FireOutlined style={{ color: '#f5222d', fontSize: 28 }} />
          班级BOSS战
        </h2>
        <p style={{ color: '#666', margin: '8px 0 0' }}>
          答题攻击BOSS，答对造成伤害，答错无效！
        </p>
      </div>

      {/* BOSS信息 */}
      <Card
        style={{
          marginBottom: 20,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: '#fff',
          borderRadius: 12
        }}
      >
        <Row gutter={[24, 24]} align="middle">
          <Col xs={24} md={8} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 120, marginBottom: 16, animation: 'boss-float 3s ease-in-out infinite' }}>
              {boss.boss_icon || '👹'}
            </div>
            <h2 style={{ color: '#fff', margin: '0 0 8px' }}>{boss.boss_name}</h2>
            <Tag color="red">Lv.{boss.boss_level}</Tag>
            {boss.knowledge_point && (
              <Tag color="blue" style={{ marginLeft: 8 }}>{boss.knowledge_point}</Tag>
            )}
          </Col>

          <Col xs={24} md={16}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>BOSS血量</span>
                <span>{boss.current_hp} / {boss.boss_max_hp}</span>
              </div>
              <Progress
                percent={boss.progress}
                strokeColor={{ from: '#f5222d', to: '#fa8c16' }}
                trailColor="rgba(255,255,255,0.2)"
                strokeWidth={24}
                format={() => `${boss.progress}%`}
              />
            </div>

            <Row gutter={16}>
              <Col xs={12} sm={8}>
                <Statistic
                  title="参与人数"
                  value={boss.participant_count}
                  prefix={<TeamOutlined />}
                  valueStyle={{ color: '#fff' }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="剩余时间"
                  value={timeLeft}
                  suffix="小时"
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: '#fff' }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="BOSS等级"
                  value={boss.boss_level}
                  prefix={<ThunderboltOutlined />}
                  valueStyle={{ color: '#fff' }}
                />
              </Col>
            </Row>

            <Button
              type="primary"
              size="large"
              block
              icon={<FireOutlined />}
              loading={questionLoading}
              disabled={cooldown > 0}
              onClick={handleAttackClick}
              style={{
                marginTop: 24,
                height: 56,
                fontSize: 20,
                background: cooldown > 0 ? 'rgba(255,255,255,0.5)' : '#fff',
                color: '#764ba2',
                border: 'none',
                fontWeight: 'bold'
              }}
            >
              {cooldown > 0 ? `冷却中... ${cooldown}秒` : '⚔️ 攻击BOSS'}
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 伤害排行榜 */}
      <Card title="🏆 伤害排行榜" size="small">
        <List
          dataSource={bossData.leaderboard || []}
          renderItem={(item: LeaderboardItem, index: number) => {
            const accuracy = item.total_attempts > 0
              ? Math.round((item.correct_answers / item.total_attempts) * 100)
              : 0;
            return (
              <List.Item>
                <List.Item.Meta
                  avatar={
                    <Badge count={index + 1} offset={[-5, 5]}>
                      <Avatar
                        size={48}
                        style={{ backgroundColor: index < 3 ? '#f5222d' : '#d9d9d9' }}
                      >
                        {item.username?.charAt(0)}
                      </Avatar>
                    </Badge>
                  }
                  title={
                    <div>
                      <span style={{ fontWeight: 'bold' }}>{item.username}</span>
                      {item.pet_name && (
                        <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>
                          ({item.pet_name} Lv.{item.pet_level})
                        </span>
                      )}
                    </div>
                  }
                  description={
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#999' }}>
                      <span>答题: {item.total_attempts}次</span>
                      <span>正确: {item.correct_answers}次</span>
                      <span>正确率: {accuracy}%</span>
                    </div>
                  }
                />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 'bold', color: '#f5222d' }}>
                    {item.damage_dealt}
                  </div>
                  <div style={{ color: '#999', fontSize: 12 }}>伤害值</div>
                </div>
              </List.Item>
            );
          }}
        />
      </Card>

      {/* 答题Modal */}
      <Modal
        title="⚔️ 攻击Boss - 请先回答问题"
        open={quizModalVisible}
        onCancel={() => setQuizModalVisible(false)}
        footer={null}
        width={isMobile ? '95vw' : 600}
        destroyOnClose
      >
        {currentQuestion && (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
              {renderTypeTag(currentQuestion.type)}
              {renderDifficultyTag(currentQuestion.difficulty)}
              <Tag color="purple">
                伤害: ×{currentQuestion.difficulty === 'easy' ? '0.5' : currentQuestion.difficulty === 'hard' ? '1.5' : '1.0'}
              </Tag>
            </div>

            <div style={{
              fontSize: 16,
              lineHeight: 1.8,
              marginBottom: 24,
              padding: 16,
              background: '#f5f5f5',
              borderRadius: 8
            }}>
              {currentQuestion.content}
            </div>

            {renderOptions()}

            {currentQuestion.hint && (
              <div style={{ marginTop: 16, color: '#999', fontSize: 13 }}>
                💡 提示: {currentQuestion.hint}
              </div>
            )}

            <Button
              type="primary"
              size="large"
              block
              loading={submitting}
              onClick={handleSubmitAnswer}
              disabled={!selectedAnswer}
              style={{ marginTop: 24 }}
            >
              提交答案并攻击
            </Button>
          </div>
        )}
      </Modal>

      {/* 攻击结果Modal */}
      <Modal
        title={attackResult?.is_correct ? '🎉 答对了！' : '😢 答错了'}
        open={resultVisible}
        onCancel={() => setResultVisible(false)}
        footer={[
          <Button key="close" onClick={() => setResultVisible(false)}>
            关闭
          </Button>
        ]}
        width={isMobile ? '95vw' : 500}
      >
        {attackResult && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            {attackResult.is_correct ? (
              <div>
                <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a' }} />
                <h2 style={{ color: '#52c41a', marginTop: 16 }}>
                  造成 {attackResult.damage} 点伤害！
                </h2>
                {attackResult.boss_defeated && (
                  <div style={{ fontSize: 20, color: '#f5222d', fontWeight: 'bold', marginTop: 8 }}>
                    🎊 BOSS已被击败！
                  </div>
                )}
              </div>
            ) : (
              <div>
                <CloseCircleOutlined style={{ fontSize: 64, color: '#ff4d4f' }} />
                <h3 style={{ color: '#ff4d4f', marginTop: 16 }}>未能造成伤害</h3>
                {attackResult.correct_answer && (
                  <div style={{ marginTop: 16, textAlign: 'left', background: '#f6ffed', padding: 16, borderRadius: 8 }}>
                    <div><strong>正确答案:</strong> {attackResult.correct_answer}</div>
                    {attackResult.explanation && (
                      <div style={{ marginTop: 8, color: '#666' }}>
                        <strong>解析:</strong> {attackResult.explanation}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Boss血量 */}
            <div style={{ marginTop: 24 }}>
              <div style={{ marginBottom: 8 }}>
                BOSS剩余血量: {attackResult.boss_current_hp} / {attackResult.boss_max_hp}
              </div>
              <Progress
                percent={Math.round((attackResult.boss_current_hp / attackResult.boss_max_hp) * 100)}
                strokeColor={{ from: '#f5222d', to: '#fa8c16' }}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* CSS动画 */}
      <style>{`
        @keyframes boss-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );
};

export default BossBattle;
