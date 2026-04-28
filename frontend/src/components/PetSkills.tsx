import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Button, Tag, message, Progress, Badge, Tabs, Empty } from 'antd';
import {
  ThunderboltOutlined,
  SafetyOutlined,
  RocketOutlined,
  StarOutlined,
  LockOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  ArrowUpOutlined,
  LoginOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000/api';

interface Skill {
  id: number;
  name: string;
  description: string;
  icon: string;
  skill_type: string;
  subject: string;
  base_damage: number;
  base_defense: number;
  base_speed: number;
  cooldown: number;
  required_level: number;
  required_knowledge_point: string | null;
  required_accuracy: number;
  isLearned: boolean;
  canUnlock: boolean;
  locked: boolean;
  level?: number;
  mastery?: number;
}

const PetSkills: React.FC = () => {
  const navigate = useNavigate();
  const [, setLoading] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [pet, setPet] = useState<any>(null);
  const [learning, setLearning] = useState<number | null>(null);
  const [upgrading, setUpgrading] = useState<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      if (!token) {
        setIsAuthenticated(false);
        return;
      }
      
      const response = await axios.get(`${API_BASE_URL}/skills/available`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSkills(response.data.skills);
      setPet(response.data.pet);
      setIsAuthenticated(true);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error;
      if (errorMsg && (errorMsg.includes('令牌') || errorMsg.includes('认证') || errorMsg.includes('登录'))) {
        setIsAuthenticated(false);
      } else {
        message.error(errorMsg || '加载技能失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLearnSkill = async (skillId: number) => {
    try {
      setLearning(skillId);
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/skills/learn`,
        { skill_id: skillId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      message.success(response.data.message);
      loadSkills();
    } catch (error: any) {
      message.error(error.response?.data?.error || '学习技能失败');
    } finally {
      setLearning(null);
    }
  };

  const handleUpgradeSkill = async (skillId: number) => {
    try {
      setUpgrading(skillId);
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/skills/upgrade`,
        { skill_id: skillId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      message.success(response.data.message);
      loadSkills();
    } catch (error: any) {
      message.error(error.response?.data?.error || '升级技能失败');
    } finally {
      setUpgrading(null);
    }
  };

  const getSkillTypeIcon = (type: string) => {
    switch (type) {
      case 'attack': return <ThunderboltOutlined />;
      case 'defense': return <SafetyOutlined />;
      case 'speed': return <RocketOutlined />;
      case 'buff': return <StarOutlined />;
      default: return <StarOutlined />;
    }
  };

  const getSkillTypeColor = (type: string) => {
    switch (type) {
      case 'attack': return 'red';
      case 'defense': return 'blue';
      case 'speed': return 'green';
      case 'buff': return 'gold';
      default: return 'default';
    }
  };

  const getSkillTypeName = (type: string) => {
    switch (type) {
      case 'attack': return '攻击型';
      case 'defense': return '防御型';
      case 'speed': return '速度型';
      case 'buff': return '增益型';
      default: return type;
    }
  };

  const renderLearnedSkills = () => {
    const learned = skills.filter(s => s.isLearned);
    
    if (learned.length === 0) {
      return (
        <Card style={{ textAlign: 'center', padding: 40, background: '#fafafa' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📚</div>
          <div style={{ color: '#999' }}>还未学习任何技能，快去解锁吧！</div>
        </Card>
      );
    }

    return (
      <Row gutter={[16, 16]}>
        {learned.map(skill => (
          <Col xs={24} sm={12} md={8} lg={6} key={skill.id}>
            <Badge.Ribbon 
              text={`Lv.${skill.level}`} 
              color="blue"
            >
              <Card
                hoverable
                style={{
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: '#fff'
                }}
              >
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>{skill.icon}</div>
                  <h3 style={{ margin: '0 0 8px', color: '#fff' }}>{skill.name}</h3>
                  <Tag color={getSkillTypeColor(skill.skill_type)}>
                    {getSkillTypeIcon(skill.skill_type)} {getSkillTypeName(skill.skill_type)}
                  </Tag>
                </div>

                <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.9 }}>
                  {skill.description}
                </div>

                <div style={{ marginBottom: 16 }}>
                  {skill.base_damage > 0 && (
                    <div style={{ marginBottom: 4 }}>⚔️ 伤害: +{skill.base_damage}</div>
                  )}
                  {skill.base_defense > 0 && (
                    <div style={{ marginBottom: 4 }}>🛡️ 防御: +{skill.base_defense}</div>
                  )}
                  {skill.base_speed > 0 && (
                    <div style={{ marginBottom: 4 }}>💨 速度: +{skill.base_speed}</div>
                  )}
                  <div>⏱️ 冷却: {skill.cooldown}小时</div>
                </div>

                <Progress
                  percent={skill.mastery || 0}
                  size="small"
                  strokeColor="#fff"
                  format={() => `精通度: ${skill.mastery}%`}
                  style={{ marginBottom: 12 }}
                />

                <Button
                  type="primary"
                  block
                  icon={<ArrowUpOutlined />}
                  loading={upgrading === skill.id}
                  onClick={() => handleUpgradeSkill(skill.id)}
                  style={{ background: '#fff', color: '#667eea', border: 'none' }}
                >
                  升级 (需要 {skill.level! * 50} 金币)
                </Button>
              </Card>
            </Badge.Ribbon>
          </Col>
        ))}
      </Row>
    );
  };

  const renderAvailableSkills = () => {
    const available = skills.filter(s => !s.isLearned && s.canUnlock);
    
    if (available.length === 0) {
      return (
        <Card style={{ textAlign: 'center', padding: 40, background: '#fafafa' }}>
          <div style={{ color: '#999' }}>暂时没有可学习的技能，提升等级或掌握更多知识点吧！</div>
        </Card>
      );
    }

    return (
      <Row gutter={[16, 16]}>
        {available.map(skill => (
          <Col xs={24} sm={12} md={8} lg={6} key={skill.id}>
            <Card
              hoverable
              style={{ borderRadius: 12 }}
            >
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 48, marginBottom: 8, opacity: 0.5 }}>{skill.icon}</div>
                <h3 style={{ margin: '0 0 8px' }}>{skill.name}</h3>
                <Tag color={getSkillTypeColor(skill.skill_type)}>
                  {getSkillTypeIcon(skill.skill_type)} {getSkillTypeName(skill.skill_type)}
                </Tag>
              </div>

              <div style={{ marginBottom: 12, fontSize: 13, color: '#666' }}>
                {skill.description}
              </div>

              <div style={{ marginBottom: 16, fontSize: 12 }}>
                {skill.base_damage > 0 && <div>⚔️ 伤害: +{skill.base_damage}</div>}
                {skill.base_defense > 0 && <div>🛡️ 防御: +{skill.base_defense}</div>}
                {skill.base_speed > 0 && <div>💨 速度: +{skill.base_speed}</div>}
                <div>⏱️ 冷却: {skill.cooldown}小时</div>
              </div>

              <div style={{ marginBottom: 16, padding: 8, background: '#f0f5ff', borderRadius: 4, fontSize: 12 }}>
                <div>📌 解锁条件:</div>
                <div>• 等级: {pet?.level}/{skill.required_level}</div>
                {skill.required_knowledge_point && (
                  <div>• 知识点: {skill.required_knowledge_point} (≥{skill.required_accuracy}%)</div>
                )}
              </div>

              <Button
                type="primary"
                block
                icon={<PlusOutlined />}
                loading={learning === skill.id}
                onClick={() => handleLearnSkill(skill.id)}
              >
                学习技能
              </Button>
            </Card>
          </Col>
        ))}
      </Row>
    );
  };

  const renderLockedSkills = () => {
    const locked = skills.filter(s => s.locked);
    
    return (
      <Row gutter={[16, 16]}>
        {locked.map(skill => (
          <Col xs={24} sm={12} md={8} lg={6} key={skill.id}>
            <Card
              style={{
                borderRadius: 12,
                opacity: 0.6,
                background: '#fafafa'
              }}
            >
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 48, marginBottom: 8, filter: 'grayscale(100%)' }}>
                  <LockOutlined />
                </div>
                <h3 style={{ margin: '0 0 8px', color: '#999' }}>???</h3>
                <Tag color="default">未解锁</Tag>
              </div>

              <div style={{ marginBottom: 16, padding: 8, background: '#fff', borderRadius: 4, fontSize: 12 }}>
                <div>🔒 解锁条件:</div>
                <div>• 等级: {pet?.level}/{skill.required_level}</div>
                {skill.required_knowledge_point && (
                  <div>• 知识点: {skill.required_knowledge_point}</div>
                )}
              </div>

              <Button block disabled>
                未满足条件
              </Button>
            </Card>
          </Col>
        ))}
      </Row>
    );
  };

  const tabItems = [
    {
      key: 'learned',
      label: <span><CheckCircleOutlined /> 已学习 ({skills.filter(s => s.isLearned).length})</span>,
      children: renderLearnedSkills()
    },
    {
      key: 'available',
      label: <span><PlusOutlined /> 可学习 ({skills.filter(s => !s.isLearned && s.canUnlock).length})</span>,
      children: renderAvailableSkills()
    },
    {
      key: 'locked',
      label: <span><LockOutlined /> 未解锁 ({skills.filter(s => s.locked).length})</span>,
      children: renderLockedSkills()
    }
  ];

  if (!isAuthenticated) {
    return (
      <Card>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              请先登录以查看宠物技能
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

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <ThunderboltOutlined style={{ color: '#faad14', fontSize: 28 }} />
          宠物技能
        </h2>
        <p style={{ color: '#666', margin: '8px 0 0' }}>
          学习并提升技能，在战斗中获得优势！技能解锁需要满足等级和知识点要求。
        </p>
        {pet && (
          <div style={{ marginTop: 12 }}>
            <Tag color="blue">当前宠物: {pet.name}</Tag>
            <Tag color="green">等级: Lv.{pet.level}</Tag>
          </div>
        )}
      </div>

      <Tabs defaultActiveKey="learned" items={tabItems} />
    </div>
  );
};

export default PetSkills;
