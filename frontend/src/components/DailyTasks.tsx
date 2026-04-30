import React, { useEffect, useState } from 'react';
import { Card, Progress, Button, message, Tag, List, Badge, Statistic, Row, Col, Alert, Empty } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  GiftOutlined,
  FireOutlined,
  BookOutlined,
  CoffeeOutlined,
  TrophyOutlined,
  LoginOutlined,
  AimOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

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

interface DailyTask {
  id: number;
  user_id: number;
  date: string;
  task_type: string;
  task_target: number;
  task_progress: number;
  is_completed: number;
  reward_claimed: number;
}

interface DailyTaskData {
  daily_task: {
    tasks_completed: number;
    total_tasks: number;
    streak_days: number;
  };
  tasks: DailyTask[];
  streak_days: number;
  claimable_rewards: DailyTask[];
}

const DailyTasks: React.FC = () => {
  const navigate = useNavigate();
  const isMobile = useMobile();
  const [loading, setLoading] = useState(false);
  const [taskData, setTaskData] = useState<DailyTaskData | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);

  useEffect(() => {
    loadDailyTasks();
  }, []);

  const loadDailyTasks = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      if (!token) {
        setIsAuthenticated(false);
        return;
      }
      
      const response = await axios.get(`${API_BASE_URL}/daily-tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTaskData(response.data);
      setIsAuthenticated(true);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error;
      if (errorMsg && (errorMsg.includes('令牌') || errorMsg.includes('认证') || errorMsg.includes('登录'))) {
        setIsAuthenticated(false);
      } else {
        message.error(errorMsg || '加载每日任务失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClaimReward = async (taskType: string) => {
    try {
      setClaiming(taskType as any);
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/daily-tasks/claim`,
        { task_type: taskType },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      message.success(response.data.message);
      
      if (response.data.all_completed) {
        message.success(`🎉 恭喜！今日所有任务完成！连续${response.data.streak_days}天！`);
      }
      
      loadDailyTasks();
    } catch (error: any) {
      message.error(error.response?.data?.error || '领取奖励失败');
    } finally {
      setClaiming(null);
    }
  };

  const getTaskIcon = (taskType: string) => {
    switch (taskType) {
      case 'login':
        return <ClockCircleOutlined />;
      case 'complete_assignment':
        return <BookOutlined />;
      case 'feed_pet':
        return <CoffeeOutlined />;
      case 'correct_rate':
        return <TrophyOutlined />;
      case 'review_weak_point':
        return <AimOutlined />;
      default:
        return <GiftOutlined />;
    }
  };
  
  const getTaskTitle = (taskType: string) => {
    switch (taskType) {
      case 'login':
        return '每日登录';
      case 'complete_assignment':
        return '完成作业';
      case 'feed_pet':
        return '投喂宠物';
      case 'correct_rate':
        return '正确率达标';
      case 'review_weak_point':
        return '复习错题';
      default:
        return taskType;
    }
  };
  
  const getTaskDescription = (task: DailyTask) => {
    switch (task.task_type) {
      case 'login':
        return '登录系统即可完成任务';
      case 'complete_assignment':
        return `完成 ${task.task_target} 道作业题`;
      case 'feed_pet':
        return `投喂宠物 ${task.task_target} 次`;
      case 'correct_rate':
        return `作业正确率达到 ${task.task_target}%`;
      case 'review_weak_point':
        return `复习 ${task.task_target} 道错题（错题本标记为已复习即可累加进度）`;
      default:
        return '';
    }
  };
  
  const getRewardGold = (taskType: string) => {
    switch (taskType) {
      case 'login':
        return 5;
      case 'complete_assignment':
        return 10;
      case 'feed_pet':
        return 5;
      case 'correct_rate':
        return 15;
      case 'review_weak_point':
        return 20;
      default:
        return 5;
    }
  };

  if (!isAuthenticated) {
    return (
      <Card>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              请先登录以查看每日任务
            </span>
          }
        >
          <Button
            type="primary"
            icon={<LoginOutlined />}
            onClick={() => navigate('/login')}
          >
            立即登录
          </Button>
        </Empty>
      </Card>
    );
  }

  if (!taskData) {
    return (
      <Card loading={loading}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          加载中...
        </div>
      </Card>
    );
  }

  const allCompleted = taskData.daily_task.tasks_completed >= taskData.daily_task.total_tasks;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FireOutlined style={{ color: '#faad14', fontSize: 28 }} />
          每日任务
        </h2>
        <p style={{ color: '#666', margin: '8px 0 0' }}>
          完成每日任务获得金币奖励，连续完成还有额外奖励！
        </p>
      </div>

      {/* 连续完成统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={8}>
          <Card>
            <Statistic
              title="今日进度"
              value={taskData.daily_task.tasks_completed}
              suffix={`/ ${taskData.daily_task.total_tasks}`}
              valueStyle={{ color: allCompleted ? '#52c41a' : '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card>
            <Statistic
              title="连续完成"
              value={taskData.streak_days}
              suffix="天"
              valueStyle={{ color: taskData.streak_days > 0 ? '#faad14' : '#999' }}
              prefix={<FireOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card>
            <Statistic
              title="可领取奖励"
              value={taskData.claimable_rewards.length}
              suffix="个"
              valueStyle={{ color: taskData.claimable_rewards.length > 0 ? '#52c41a' : '#999' }}
              prefix={<GiftOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 全部完成提示 */}
      {allCompleted && (
        <Alert
          type="success"
          message="🎉 恭喜！今日所有任务已完成！"
          description="继续保持，明天的任务会更精彩！"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 任务列表 */}
      <Card title="今日任务列表" size="small">
        <List
          dataSource={taskData.tasks}
          renderItem={(task) => {
            const progress = Math.min((task.task_progress / task.task_target) * 100, 100);
            const isCompleted = task.is_completed === 1;
            const isClaimed = task.reward_claimed === 1;
            const rewardGold = getRewardGold(task.task_type);

            return (
              <List.Item
                style={{
                  padding: '16px',
                  background: isCompleted ? '#f6ffed' : '#fff',
                  borderRadius: 8,
                  marginBottom: 12,
                  border: isCompleted ? '1px solid #b7eb8f' : '1px solid #f0f0f0'
                }}
              >
                <List.Item.Meta
                  avatar={
                    <Badge count={isCompleted ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : null}>
                      <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: '50%',
                        background: isCompleted ? '#f6ffed' : '#f5f5f5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 24,
                        color: isCompleted ? '#52c41a' : '#999'
                      }}>
                        {getTaskIcon(task.task_type)}
                      </div>
                    </Badge>
                  }
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16, fontWeight: 500 }}>
                        {getTaskTitle(task.task_type)}
                      </span>
                      {isCompleted && (
                        <Tag color="success" icon={<CheckCircleOutlined />}>已完成</Tag>
                      )}
                      {isClaimed && (
                        <Tag color="default">已领取</Tag>
                      )}
                    </div>
                  }
                  description={
                    <div style={{ marginTop: 8 }}>
                      <div style={{ color: '#666', marginBottom: 8 }}>
                        {getTaskDescription(task)}
                      </div>
                      <Progress
                        percent={Math.round(progress)}
                        status={isCompleted ? 'success' : 'active'}
                        size="small"
                        format={() => `${task.task_progress} / ${task.task_target}`}
                      />
                    </div>
                  }
                />
                <div style={{ textAlign: 'right', minWidth: 120 }}>
                  <div style={{ marginBottom: 8, color: '#faad14', fontWeight: 'bold', fontSize: 16 }}>
                    +{rewardGold} 金币
                  </div>
                  {isCompleted && !isClaimed && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<GiftOutlined />}
                      loading={claiming === (task.task_type as any)}
                      onClick={() => handleClaimReward(task.task_type)}
                    >
                      领取奖励
                    </Button>
                  )}
                </div>
              </List.Item>
            );
          }}
        />
      </Card>

      {/* 任务说明 */}
      <Card title="任务说明" size="small" style={{ marginTop: 16 }}>
        <div style={{ color: '#666', lineHeight: 1.8 }}>
          <p>• <strong>每日登录</strong>：每天登录系统即可完成任务，奖励 5 金币</p>
          <p>• <strong>完成作业</strong>：完成任意一道作业题，奖励 10 金币</p>
          <p>• <strong>投喂宠物</strong>：使用道具投喂宠物一次，奖励 5 金币</p>
          <p>• <strong>正确率达标</strong>：单次作业正确率达到 80% 以上，奖励 15 金币</p>
          <p style={{ marginTop: 12, padding: '8px 12px', background: '#fff7e6', borderRadius: 4 }}>
            💡 <strong>提示</strong>：连续完成所有任务可获得额外奖励，坚持就是胜利！
          </p>
        </div>
      </Card>
    </div>
  );
};

export default DailyTasks;
