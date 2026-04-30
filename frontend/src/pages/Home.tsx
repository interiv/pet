import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Card, Row, Col, Statistic, Tabs, TabsProps, Modal, Spin, Table, Segmented, Drawer, Button, Steps, message, Alert } from 'antd';
import {
  HomeOutlined,
  BookOutlined,
  TrophyOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  TeamOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
  BellOutlined,
  NotificationOutlined,
  MenuOutlined,
  CommentOutlined,
  FireOutlined,
  BarChartOutlined,
  ThunderboltOutlined,
  HeartOutlined,
} from '@ant-design/icons';
import { petAPI, leaderboardAPI, adminAPI } from '../utils/api';
import { useAuthStore, usePetStore } from '../store/authStore';
import PetDisplay from '../components/PetDisplay';
import CreatePet from '../components/CreatePet';
import Assignments from '../components/Assignments';
import WrongQuestions from '../components/WrongQuestions';
import Battle from '../components/Battle';
import ShopAndBackpack from '../components/ShopAndBackpack';
import Friends from '../components/Friends';
import Admin from '../components/Admin';
import Profile from '../components/Profile';
import Achievements from '../components/Achievements';
import Posts from '../components/Posts';
import ChatRoom from '../components/ChatRoom';
import Forum from '../components/Forum';
import Notifications from '../components/Notifications';
import ClassInvitationManager from '../components/ClassInvitationManager';
import DailyTasks from '../components/DailyTasks';
import LearningDashboard from '../components/LearningDashboard';
import PetSkills from '../components/PetSkills';
import BossBattle from '../components/BossBattle';
import ClassDashboard from '../components/ClassDashboard';

const { Header, Content, Sider, Footer } = Layout;

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};


const Home: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout, isAuthenticated } = useAuthStore();
  const { pet, setPet, hasPet } = usePetStore();
  const isMobile = useMobile();

  const [siteSettings, setSiteSettings] = useState<any>({});
  const [activeMenu, setActiveMenu] = useState('home');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [allPets, setAllPets] = useState<any[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPet, setSelectedPet] = useState<any>(null);
  const [loadingPetDetail, setLoadingPetDetail] = useState(false);
  const [petEquipments, setPetEquipments] = useState<any[]>([]);
  const [petBonus, setPetBonus] = useState<any>(null);
  const [leaderboardView, setLeaderboardView] = useState<'card' | 'list'>('card');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [myClasses, setMyClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [taughtClassPets, setTaughtClassPets] = useState<any[]>([]);
  
  // 新手引导状态
  const [newbieGuideVisible, setNewbieGuideVisible] = useState(false);
  const [newbieStep, setNewbieStep] = useState(0);
  const [, setGuidePetCreated] = useState(false);
  const [guidePetData, setGuidePetData] = useState<any>(null);

  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';
  const isStudent = user?.role === 'student';

  useEffect(() => {
    loadSiteSettings();
  }, []);

  const loadSiteSettings = async () => {
    try {
      const res = await adminAPI.getPublicSettings();
      setSiteSettings(res.data.settings || {});
    } catch (e) {
      console.log('加载站点设置失败');
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      // 检查新手引导
      checkNewbieGuide();
      
      if (isStudent) {
        loadPetData();
        loadMyClassPets();
      } else if (isTeacher) {
        loadTeacherClasses();
      } else {
        loadPetData();
        loadAllPets();
      }
    } else {
      loadAllPets();
    }
  }, [isAuthenticated, user]);
  
  const checkNewbieGuide = async () => {
    // 如果是学生且未完成引导
    if (isStudent) {
      const newbieGuide = localStorage.getItem('newbie_guide');
      if (!newbieGuide) {
        // 检查是否有宠物
        try {
          await petAPI.getMyPet();
          // 有宠物，标记为完成
          localStorage.setItem('newbie_guide', 'completed');
        } catch (error) {
          // 没有宠物，显示引导
          setNewbieGuideVisible(true);
          setNewbieStep(0);
        }
      }
    }
  };

  const loadTeacherClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      const classes = res.data.classes || [];
      setMyClasses(classes);
      if (classes.length > 0) {
        setSelectedClassId(classes[0].id);
        loadClassPetsForTeacher(classes[0].id);
        loadAllTaughtClassPets(classes);
      }
    } catch (error) {
      console.error('加载教师班级失败:', error);
    }
  };

  const loadAllTaughtClassPets = async (classes: any[]) => {
    const classIds = classes.map((c: any) => c.id);
    const allPetLists = await Promise.all(
      classIds.map((cid: number) => petAPI.getAllPets({ class_id: cid }).then(r => r.data.pets || []).catch(() => []))
    );
    const merged = allPetLists.flat();
    const uniquePets = Array.from(new Map(merged.map(p => [p.id, p])).values());
    setTaughtClassPets(uniquePets);
  };

  const loadClassPetsForTeacher = async (classId: number) => {
    try {
      const response = await petAPI.getAllPets({ class_id: classId });
      const pets = response.data.pets || [];
      setAllPets(pets);
      const sorted = [...pets].sort((a: any, b: any) => b.level - a.level || b.exp - a.exp).slice(0, 10);
      setLeaderboard(sorted);
    } catch (error) {
      console.error('加载班级宠物失败:', error);
    }
  };

  const loadMyClassPets = async () => {
    try {
      const res = await adminAPI.getClasses();
      const classes = res.data.classes || [];
      if (classes.length > 0) {
        const classIds = classes.map((c: any) => c.id);
        const allPetLists = await Promise.all(
          classIds.map((cid: number) => petAPI.getAllPets({ class_id: cid }).then(r => r.data.pets || []).catch(() => []))
        );
        const merged = allPetLists.flat();
        const uniquePets = Array.from(new Map(merged.map(p => [p.id, p])).values());
        setAllPets(uniquePets);
        loadLeaderboard(uniquePets);
      } else {
        setAllPets([]);
        loadLeaderboard();
      }
    } catch (error) {
      console.error('加载班级宠物失败:', error);
    }
  };

  const loadAllPets = async (classId?: number) => {
    try {
      const params = classId ? { class_id: classId } : {};
      const response = await petAPI.getAllPets(params);
      const pets = response.data.pets || [];
      setAllPets(pets);
      loadLeaderboard(pets);
    } catch (error) {
      console.error('加载宠物列表失败:', error);
    }
  };

  const loadPetData = async () => {
    try {
      const response = await petAPI.getMyPet();
      setPet(response.data.pet);
      setGuidePetData(response.data.pet);
    } catch (error) {
      console.log('还没有宠物');
    }
  };
  
  const handleNewbiePetCreated = async () => {
    setGuidePetCreated(true);
    setNewbieStep(1);
    message.success('🎉 宠物创建成功！让我们开始新手任务吧！');
    loadPetData();
  };
  
  const handleNewbieNextStep = () => {
    if (newbieStep < 3) {
      setNewbieStep(newbieStep + 1);
    } else {
      // 完成引导
      localStorage.setItem('newbie_guide', 'completed');
      setNewbieGuideVisible(false);
      message.success('🎊 新手引导完成！开始你的学习之旅吧！');
    }
  };

  const loadLeaderboard = async (classPets?: any[]) => {
    try {
      if (classPets && classPets.length > 0) {
        const sorted = [...classPets].sort((a: any, b: any) => b.level - a.level || b.exp - a.exp).slice(0, 10);
        setLeaderboard(sorted);
      } else {
        const response = await leaderboardAPI.getLevelLeaderboard();
        setLeaderboard(response.data.leaderboard);
      }
    } catch (error) {
      console.error('加载排行榜失败:', error);
    }
  };

  const handleViewPet = async (petItem: any) => {
    try {
      setLoadingPetDetail(true);
      setModalVisible(true);
      
      const response = await petAPI.getUserPet(petItem.user_id);
      setSelectedPet(response.data.pet);
      setPetEquipments(response.data.equipments || []);
      setPetBonus(response.data.bonus || null);
    } catch (error) {
      console.error('加载宠物详情失败:', error);
    } finally {
      setLoadingPetDetail(false);
    }
  };

  const menuItems: any[] = [
    {
      key: 'home',
      icon: <HomeOutlined />,
      label: '首页',
    },
  ];

  if (isStudent) {
    menuItems.push(
      { key: 'pet', icon: <HomeOutlined />, label: '我的宠物' },
      { key: 'assignment', icon: <BookOutlined />, label: '作业' },
      { key: 'wrong_questions', icon: <ExclamationCircleOutlined />, label: '错题本' },
      { key: 'battle', icon: <TrophyOutlined />, label: '战斗' },
    );
  } else if (isTeacher) {
    menuItems.push(
      { key: 'assignment', icon: <BookOutlined />, label: '作业' },
      { key: 'class-dashboard', icon: <BarChartOutlined />, label: '班级学情' },
    );
  }

  menuItems.push(
    { key: 'friends', icon: <UserOutlined />, label: '我的好友' },
    { key: 'daily-tasks', icon: <FireOutlined />, label: '每日任务' },
    { key: 'learning-dashboard', icon: <BarChartOutlined />, label: '学习数据' },
    { key: 'pet-skills', icon: <ThunderboltOutlined />, label: '宠物技能' },
    { key: 'boss-battle', icon: <FireOutlined />, label: 'BOSS战' },
    { key: 'achievements', icon: <TrophyOutlined />, label: '成就' },
    { key: 'posts', icon: <NotificationOutlined />, label: '班级动态' },
    { key: 'chat', icon: <MessageOutlined />, label: '群聊' },
    { key: 'forum', icon: <CommentOutlined />, label: '论坛' },
    { key: 'notifications', icon: <BellOutlined />, label: '通知中心' },
  );

  if (user?.role === 'admin') {
    menuItems.push({
      key: 'admin',
      icon: <SettingOutlined />,
      label: '管理后台',
    });
  }

  if (user?.role === 'teacher') {
    menuItems.push({
      key: 'applications',
      icon: <TeamOutlined />,
      label: '教师工作台',
    });
    menuItems.push({
      key: 'class-management',
      icon: <TeamOutlined />,
      label: '班级管理',
    });
  }

  const userMenu = {
    items: [
      {
        key: 'profile',
        icon: <UserOutlined />,
        label: '个人中心',
        onClick: () => {
          setActiveMenu('profile');
        },
      },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: '退出登录',
        onClick: () => {
          logout();
          navigate('/login');
        },
      },
    ],
  };

  const [petsView, setPetsView] = useState<'card' | 'list'>('card');

  const getPetsTitle = () => {
    if (user?.role === 'admin') return '全校宠物';
    return '全班宠物';
  };

  const petsColumns = [
    { title: '宠物名', dataIndex: 'name', key: 'name' },
    { title: '主人', dataIndex: 'owner_name', key: 'owner_name' },
    { title: '等级', dataIndex: 'level', key: 'level' },
    { title: '物种', dataIndex: 'species_name', key: 'species_name' },
    { title: '经验', dataIndex: 'exp', key: 'exp' },
  ];

  const allPetsChildren = (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, color: '#666' }}>{getPetsTitle()}</span>
        <Segmented
          options={[
            { label: '卡片', value: 'card' },
            { label: '列表', value: 'list' },
          ]}
          value={petsView}
          onChange={(value) => setPetsView(value as 'card' | 'list')}
        />
      </div>
      {petsView === 'card' ? (
        <Row gutter={[16, 16]}>
          {allPets.map((item: any) => (
            <Col xs={24} sm={12} md={8} lg={6} key={item.id}>
              <Card
                hoverable
                onClick={() => handleViewPet(item)}
                style={{ borderRadius: '12px', overflow: 'hidden', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', cursor: 'pointer' }}
                styles={{ body: { padding: '16px' } }}
                cover={
                  <div style={{ height: 180, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(to bottom, #f5f7fa 0%, #c3cfe2 100%)', padding: '20px' }}>
                    <img alt={item.name} src={(() => {
                      try {
                        const urls = typeof item.image_urls === 'string' ? JSON.parse(item.image_urls) : item.image_urls;
                        return urls[item.growth_stage] || urls['成年期'] || Object.values(urls)[0] || '';
                      } catch (e) {
                        return item.image_urls;
                      }
                    })()} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', filter: 'drop-shadow(0 10px 8px rgba(0,0,0,0.2))' }} />
                  </div>
                }
                size="small"
              >
                <Card.Meta
                  title={<span style={{ fontSize: '16px', fontWeight: 'bold' }}>{item.name}</span>}
                  description={<span style={{ color: '#8c8c8c' }}>{item.owner_name}的宠物</span>}
                  style={{ marginBottom: '12px' }}
                />
                <Statistic
                  title={<span style={{ fontSize: '12px' }}>当前等级</span>}
                  value={item.level}
                  suffix={`级 (${item.species_name})`}
                  valueStyle={{ color: '#1890ff', fontSize: '20px', fontWeight: 'bold' }}
                />
              </Card>
            </Col>
          ))}
          {allPets.length === 0 && (
            <div style={{ textAlign: 'center', width: '100%', padding: '20px', color: '#999' }}>
              暂无宠物数据
            </div>
          )}
        </Row>
      ) : (
        <Table
          dataSource={allPets}
          columns={petsColumns}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          size="small"
        />
      )}
    </div>
  );

  const getLeaderboardTitle = () => {
    if (user?.role === 'admin') return '全校宠物排行榜';
    return '全班宠物排行榜';
  };

  const leaderboardColumns = [
    { title: '排名', key: 'rank', width: 60, render: (_: any, __: any, index: number) => index + 1 },
    { title: '宠物名', dataIndex: 'name', key: 'name' },
    { title: '主人', dataIndex: 'owner_name', key: 'owner_name' },
    { title: '等级', dataIndex: 'level', key: 'level' },
    { title: '物种', dataIndex: 'species_name', key: 'species_name' },
    { title: '经验', dataIndex: 'exp', key: 'exp' },
    { title: '金币', dataIndex: 'gold', key: 'gold', responsive: ['md'] as any },
    { title: '体力', dataIndex: 'stamina', key: 'stamina', responsive: ['md'] as any },
    { title: '饱腹度', dataIndex: 'hunger', key: 'hunger', responsive: ['md'] as any },
    { title: '心情', dataIndex: 'mood', key: 'mood', responsive: ['md'] as any },
    { title: '健康', dataIndex: 'health', key: 'health', responsive: ['md'] as any },
  ];

  const leaderboardChildren = (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, color: '#666' }}>{getLeaderboardTitle()}</span>
        <Segmented
          options={[
            { label: '卡片', value: 'card' },
            { label: '列表', value: 'list' },
          ]}
          value={leaderboardView}
          onChange={(value) => setLeaderboardView(value as 'card' | 'list')}
        />
      </div>
      {leaderboardView === 'card' ? (
        <Row gutter={[16, 16]}>
          {leaderboard.map((item: any, index: number) => (
            <Col xs={24} sm={12} md={8} lg={6} key={item.id}>
              <Card
                hoverable
                onClick={() => handleViewPet(item)}
                style={{ borderRadius: '12px', overflow: 'hidden', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', cursor: 'pointer' }}
                styles={{ body: { padding: '16px' } }}
                cover={
                  <div style={{ height: 180, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(to bottom, #fdfbfb 0%, #ebedee 100%)', padding: '20px', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 10, left: 10, fontSize: '24px', fontWeight: 'bold', color: '#faad14', textShadow: '2px 2px 4px rgba(0,0,0,0.1)' }}>#{index + 1}</div>
                    <img alt={item.name} src={(() => {
                      try {
                        const urls = typeof item.image_urls === 'string' ? JSON.parse(item.image_urls) : item.image_urls;
                        return urls[item.growth_stage] || urls['成年期'] || Object.values(urls)[0] || '';
                      } catch (e) {
                        return item.image_urls;
                      }
                    })()} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', filter: 'drop-shadow(0 10px 8px rgba(0,0,0,0.2))' }} />
                  </div>
                }
                size="small"
              >
                <Card.Meta
                  title={<span style={{ fontSize: '16px', fontWeight: 'bold' }}>{item.name}</span>}
                  description={<span style={{ color: '#8c8c8c' }}>{item.owner_name}的宠物</span>}
                  style={{ marginBottom: '12px' }}
                />
                <Statistic
                  title={<span style={{ fontSize: '12px' }}>当前等级</span>}
                  value={item.level}
                  suffix={`级 (${item.species_name})`}
                  valueStyle={{ color: '#faad14', fontSize: '20px', fontWeight: 'bold' }}
                />
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <Table
          dataSource={leaderboard}
          columns={leaderboardColumns}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          size="small"
        />
      )}
    </div>
  );

  const taughtLeaderboardChildren = (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, color: '#666' }}>任教各班宠物排行榜</span>
        {myClasses.length > 1 && (
          <Segmented
            options={myClasses.map((c: any) => ({ label: c.name, value: c.id }))}
            value={selectedClassId || undefined}
            onChange={(value) => { setSelectedClassId(value as number); loadClassPetsForTeacher(value as number); }}
          />
        )}
        <Segmented
          options={[
            { label: '卡片', value: 'card' },
            { label: '列表', value: 'list' },
          ]}
          value={leaderboardView}
          onChange={(value) => setLeaderboardView(value as 'card' | 'list')}
        />
      </div>
      {leaderboardView === 'card' ? (
        <Row gutter={[16, 16]}>
          {leaderboard.map((item: any, index: number) => (
            <Col xs={24} sm={12} md={8} lg={6} key={item.id}>
              <Card
                hoverable
                onClick={() => handleViewPet(item)}
                style={{ borderRadius: '12px', overflow: 'hidden', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', cursor: 'pointer' }}
                styles={{ body: { padding: '16px' } }}
                cover={
                  <div style={{ height: 180, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(to bottom, #fdfbfb 0%, #ebedee 100%)', padding: '20px', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 10, left: 10, fontSize: '24px', fontWeight: 'bold', color: '#faad14', textShadow: '2px 2px 4px rgba(0,0,0,0.1)' }}>#{index + 1}</div>
                    <img alt={item.name} src={(() => {
                      try {
                        const urls = typeof item.image_urls === 'string' ? JSON.parse(item.image_urls) : item.image_urls;
                        return urls[item.growth_stage] || urls['成年期'] || Object.values(urls)[0] || '';
                      } catch (e) { return item.image_urls; }
                    })()} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', filter: 'drop-shadow(0 10px 8px rgba(0,0,0,0.2))' }} />
                  </div>
                }
                size="small"
              >
                <Card.Meta title={<span style={{ fontSize: '16px', fontWeight: 'bold' }}>{item.name}</span>} description={<span style={{ color: '#8c8c8c' }}>{item.owner_name}的宠物</span>} style={{ marginBottom: '12px' }} />
                <Statistic title={<span style={{ fontSize: '12px' }}>当前等级</span>} value={item.level} suffix={`级 (${item.species_name})`} valueStyle={{ color: '#faad14', fontSize: '20px', fontWeight: 'bold' }} />
              </Card>
            </Col>
          ))}
          {leaderboard.length === 0 && <div style={{ textAlign: 'center', width: '100%', padding: '20px', color: '#999' }}>该班级暂无宠物</div>}
        </Row>
      ) : (
        <Table dataSource={leaderboard} columns={leaderboardColumns} rowKey="id" pagination={{ pageSize: 10 }} size="small" />
      )}
    </div>
  );

  const allTaughtLeaderboardChildren = (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, color: '#666' }}>任教各班宠物总排行</span>
        <Segmented options={[{ label: '卡片', value: 'card' }, { label: '列表', value: 'list' }]} value={leaderboardView} onChange={(value) => setLeaderboardView(value as 'card' | 'list')} />
      </div>
      {(() => {
        const sorted = [...taughtClassPets].sort((a: any, b: any) => b.level - a.level || b.exp - a.exp).slice(0, 10);
        if (leaderboardView === 'card') {
          return (
            <Row gutter={[16, 16]}>
              {sorted.map((item: any, index: number) => (
                <Col xs={24} sm={12} md={8} lg={6} key={item.id}>
                  <Card hoverable onClick={() => handleViewPet(item)} style={{ borderRadius: '12px', overflow: 'hidden', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', cursor: 'pointer' }} styles={{ body: { padding: '16px' } }} cover={
                    <div style={{ height: 180, display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'linear-gradient(to bottom, #fdfbfb 0%, #ebedee 100%)', padding: '20px', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 10, left: 10, fontSize: '24px', fontWeight: 'bold', color: '#faad14', textShadow: '2px 2px 4px rgba(0,0,0,0.1)' }}>#{index + 1}</div>
                      <img alt={item.name} src={(() => { try { const urls = typeof item.image_urls === 'string' ? JSON.parse(item.image_urls) : item.image_urls; return urls[item.growth_stage] || urls['成年期'] || Object.values(urls)[0] || ''; } catch (e) { return item.image_urls; } })()} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', filter: 'drop-shadow(0 10px 8px rgba(0,0,0,0.2))' }} />
                    </div>
                  } size="small">
                    <Card.Meta title={<span style={{ fontSize: '16px', fontWeight: 'bold' }}>{item.name}</span>} description={<span style={{ color: '#8c8c8c' }}>{item.owner_name}的宠物</span>} style={{ marginBottom: '12px' }} />
                    <Statistic title={<span style={{ fontSize: '12px' }}>当前等级</span>} value={item.level} suffix={`级 (${item.species_name})`} valueStyle={{ color: '#faad14', fontSize: '20px', fontWeight: 'bold' }} />
                  </Card>
                </Col>
              ))}
              {sorted.length === 0 && <div style={{ textAlign: 'center', width: '100%', padding: '20px', color: '#999' }}>暂无宠物数据</div>}
            </Row>
          );
        }
        return <Table dataSource={sorted} columns={leaderboardColumns} rowKey="id" pagination={{ pageSize: 10 }} size="small" />;
      })()}
    </div>
  );

  const teacherTabItems: TabsProps['items'] = [
    { key: 'class_leaderboard', label: '本班宠物排行', children: taughtLeaderboardChildren },
    { key: 'all_taught_leaderboard', label: '任教各班排行', children: allTaughtLeaderboardChildren },
  ];

  const studentHomeTabItems: TabsProps['items'] = [
    { key: 'class_leaderboard', label: '本班宠物排行', children: leaderboardChildren },
  ];

  const studentPetTabItems: TabsProps['items'] = [
    { key: 'pet', label: '我的宠物', children: hasPet ? <PetDisplay pet={pet} onNavigate={setActiveMenu} /> : <CreatePet onSuccess={loadPetData} /> },
    { key: 'shop', label: '道具商店', children: <ShopAndBackpack defaultTab="shop" viewMode="shop" /> },
    { key: 'backpack', label: '我的背包', children: <ShopAndBackpack defaultTab="backpack" viewMode="backpack" /> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1,
        padding: isMobile ? '0 12px' : '0 24px',
        height: isMobile ? 56 : 64,
        position: 'sticky',
        top: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20 }}>
          {isMobile && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              size="large"
              style={{ color: '#fff' }}
            />
          )}
          <span style={{ fontSize: isMobile ? 22 : 28 }}>{siteSettings.site_logo || '🐾'}</span>
          <span style={{ fontSize: isMobile ? 14 : 18, fontWeight: 'bold', color: '#fff', display: isMobile ? 'none' : 'block' }}>{siteSettings.site_name || '班级宠物养成系统'}</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16 }}>
          {isAuthenticated ? (
            <>
              {isStudent && pet && (
                <div style={{ display: isMobile ? 'none' : 'flex', alignItems: 'center', gap: 6, color: '#ffd700', fontSize: 14 }}>
                  <span>💰 {user?.gold || 0}</span>
                  <span>⭐ Lv.{pet.level}</span>
                </div>
              )}
              {!isMobile && <span style={{ color: 'rgba(255,255,255,0.85)' }}>欢迎，{user?.username}</span>}
              {isMobile && <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.username}</span>}
              <Dropdown menu={userMenu} placement="bottomRight">
                <Avatar 
                  size={isMobile ? 32 : 40} 
                  icon={<UserOutlined />} 
                  src={user?.avatar}
                  style={{ cursor: 'pointer', background: '#87d068', border: '2px solid rgba(255,255,255,0.5)' }}
                />
              </Dropdown>
            </>
          ) : (
            <div style={{ display: 'flex', gap: isMobile ? 8 : 10 }}>
              <a onClick={() => navigate('/login')} style={{ color: '#fff', fontSize: isMobile ? 13 : undefined }}>登录</a>
              <a onClick={() => navigate('/register')} style={{ color: '#fff', fontSize: isMobile ? 13 : undefined }}>注册</a>
            </div>
          )}
        </div>
      </Header>

      <Layout>
        {isMobile ? (
          <>
            {/* 移动端侧边栏抽屉 */}
            <Drawer
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>🐾</span>
                  <span>导航菜单</span>
                </div>
              }
              placement="left"
              onClose={() => setMobileMenuOpen(false)}
              open={mobileMenuOpen}
              width={260}
              styles={{
                body: { padding: 0 },
                header: { borderBottom: '1px solid #f0f0f0' }
              }}
            >
              <Menu
                mode="inline"
                selectedKeys={[activeMenu]}
                style={{ borderRight: 0 }}
                items={menuItems}
                onClick={({ key }) => {
                  if (key === 'profile') return;
                  setActiveMenu(key);
                  setMobileMenuOpen(false);
                }}
              />
            </Drawer>

            <Content style={{ 
              padding: isMobile ? '12px' : '24px 40px', 
              background: '#f0f2f5', 
              minHeight: 'calc(100vh - 56px)' 
            }}>
              <div style={{ 
                background: '#fff', 
                padding: isMobile ? 16 : 32, 
                borderRadius: 12, 
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)', 
                minHeight: '100%' 
              }}>
                {activeMenu === 'assignment' ? (
                  <Assignments onNavigate={setActiveMenu} />
                ) : activeMenu === 'wrong_questions' ? (
                  <WrongQuestions />
                ) : activeMenu === 'battle' ? (
                  <Battle />
                ) : activeMenu === 'friends' ? (
                  <Friends />
                ) : activeMenu === 'daily-tasks' ? (
                  <DailyTasks />
                ) : activeMenu === 'learning-dashboard' ? (
                  <LearningDashboard />
                ) : activeMenu === 'pet-skills' ? (
                  <PetSkills />
                ) : activeMenu === 'boss-battle' ? (
                  <BossBattle />
                ) : activeMenu === 'achievements' ? (
                  <Achievements />
                ) : activeMenu === 'posts' ? (
                  <Posts />
                ) : activeMenu === 'chat' ? (
                  <ChatRoom />
                ) : activeMenu === 'forum' ? (
                  <Forum />
                ) : activeMenu === 'notifications' ? (
                  <Notifications />
                ) : activeMenu === 'admin' ? (
                  <Admin />
                ) : activeMenu === 'applications' ? (
                  <Admin defaultTab="applications" />
                ) : activeMenu === 'class-management' ? (
                  <ClassInvitationManager />
                ) : activeMenu === 'class-dashboard' ? (
                  <ClassDashboard />
                ) : activeMenu === 'profile' ? (
                  <Profile />
                ) : isAuthenticated && isTeacher ? (
                  <Tabs
                    activeKey={activeMenu === 'home' ? 'class_leaderboard' : activeMenu}
                    onChange={(key) => setActiveMenu(key)}
                    items={teacherTabItems}
                    size={isMobile ? 'small' : 'middle'}
                    centered={isMobile}
                  />
                ) : isAuthenticated && isStudent ? (
                  <Tabs
                    activeKey={['pet', 'shop', 'backpack'].includes(activeMenu) ? activeMenu : 'class_leaderboard'}
                    onChange={(key) => {
                      setActiveMenu(key);
                    }}
                    items={['pet', 'shop', 'backpack'].includes(activeMenu) ? studentPetTabItems : studentHomeTabItems}
                    size={isMobile ? 'small' : 'middle'}
                    centered={isMobile}
                  />
                ) : isAuthenticated ? (
                  <Tabs
                    activeKey="all_pets"
                    onChange={(key) => setActiveMenu(key)}
                    items={[{ key: 'all_pets', label: '全校宠物', children: allPetsChildren }, { key: 'leaderboard', label: '排行榜', children: leaderboardChildren }]}
                    size={isMobile ? 'small' : 'middle'}
                    centered={isMobile}
                  />
                ) : (
                  <Tabs 
                    activeKey={['all_pets', 'leaderboard'].includes(activeMenu) ? activeMenu : 'all_pets'} 
                    onChange={(key) => setActiveMenu(key)}
                    items={[{ key: 'all_pets', label: '全校宠物', children: allPetsChildren }, { key: 'leaderboard', label: '排行榜', children: leaderboardChildren }]}
                    size={isMobile ? 'small' : 'middle'}
                    centered={isMobile}
                  />
                )}
              </div>
            </Content>
          </>
        ) : (
          <>
            <Sider width={200} style={{ background: '#fff', boxShadow: '2px 0 8px rgba(0,0,0,0.05)', zIndex: 0 }}>
              <Menu
                mode="inline"
                selectedKeys={[activeMenu]}
                style={{ height: '100%', borderRight: 0, padding: '16px 0' }}
                items={menuItems}
                onClick={({ key}) => {
                  if (key === 'profile') return;
                  setActiveMenu(key);
                }}
              />
            </Sider>

            <Content style={{ padding: '24px 40px', background: '#f0f2f5', minHeight: 'calc(100vh - 64px)' }}>
              <div style={{ background: '#fff', padding: 32, borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)', minHeight: '100%' }}>
                {activeMenu === 'assignment' ? (
                  <Assignments onNavigate={setActiveMenu} />
                ) : activeMenu === 'wrong_questions' ? (
                  <WrongQuestions />
                ) : activeMenu === 'battle' ? (
                  <Battle />
                ) : activeMenu === 'friends' ? (
                  <Friends />
                ) : activeMenu === 'daily-tasks' ? (
                  <DailyTasks />
                ) : activeMenu === 'learning-dashboard' ? (
                  <LearningDashboard />
                ) : activeMenu === 'pet-skills' ? (
                  <PetSkills />
                ) : activeMenu === 'boss-battle' ? (
                  <BossBattle />
                ) : activeMenu === 'achievements' ? (
                  <Achievements />
                ) : activeMenu === 'posts' ? (
                  <Posts />
                ) : activeMenu === 'chat' ? (
                  <ChatRoom />
                ) : activeMenu === 'forum' ? (
                  <Forum />
                ) : activeMenu === 'notifications' ? (
                  <Notifications />
                ) : activeMenu === 'admin' ? (
                  <Admin />
                ) : activeMenu === 'applications' ? (
                  <Admin defaultTab="applications" />
                ) : activeMenu === 'class-management' ? (
                  <ClassInvitationManager />
                ) : activeMenu === 'class-dashboard' ? (
                  <ClassDashboard />
                ) : activeMenu === 'profile' ? (
                  <Profile />
                ) : isAuthenticated && isTeacher ? (
                  <Tabs
                    activeKey={activeMenu === 'home' ? 'class_leaderboard' : activeMenu}
                    onChange={(key) => setActiveMenu(key)}
                    items={teacherTabItems}
                  />
                ) : isAuthenticated && isStudent ? (
                  <Tabs
                    activeKey={['pet', 'shop', 'backpack'].includes(activeMenu) ? activeMenu : 'class_leaderboard'}
                    onChange={(key) => {
                      setActiveMenu(key);
                    }}
                    items={['pet', 'shop', 'backpack'].includes(activeMenu) ? studentPetTabItems : studentHomeTabItems}
                  />
                ) : isAuthenticated ? (
                  <Tabs
                    activeKey="all_pets"
                    onChange={(key) => setActiveMenu(key)}
                    items={[{ key: 'all_pets', label: '全校宠物', children: allPetsChildren }, { key: 'leaderboard', label: '排行榜', children: leaderboardChildren }]}
                  />
                ) : (
                  <Tabs 
                    activeKey="all_pets"
                    onChange={(key) => setActiveMenu(key)}
                    items={[{ key: 'all_pets', label: '全校宠物', children: allPetsChildren }, { key: 'leaderboard', label: '排行榜', children: leaderboardChildren }]}
                  />
                )}
              </div>
            </Content>
          </>
        )}
      </Layout>

      {siteSettings.site_announcement && (
        <div style={{
          background: 'linear-gradient(90deg, #fff7e6 0%, #ffe7ba 100%)',
          padding: '8px 24px',
          textAlign: 'center',
          borderTop: '1px solid #ffd591',
          borderBottom: '1px solid #ffd591',
        }}>
          <NotificationOutlined style={{ color: '#fa8c16', marginRight: 8 }} />
          <span style={{ color: '#ad6800', fontSize: 13 }}>{siteSettings.site_announcement}</span>
        </div>
      )}

      <Footer style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        color: 'rgba(255,255,255,0.65)',
        textAlign: 'center',
        padding: isMobile ? '16px 12px' : '24px 50px',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>{siteSettings.site_logo || '🐾'}</span>
            <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>{siteSettings.site_name || '班级宠物养成系统'}</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 8 }}>
            {siteSettings.site_description || '寓教于乐，让学习更有趣'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 12 }}>
            <a style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, cursor: 'pointer' }}>关于我们</a>
            <a style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, cursor: 'pointer' }}>使用帮助</a>
            <a style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, cursor: 'pointer' }}>隐私政策</a>
            <a style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, cursor: 'pointer' }}>联系我们</a>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
            <span style={{ fontSize: 12 }}>{siteSettings.site_footer || '© 2024 班级宠物养成系统'}</span>
            <span style={{ margin: '0 8', fontSize: 12 }}>|</span>
            <span style={{ fontSize: 12 }}>用 <HeartOutlined style={{ color: '#ff4d4f' }} /> 打造</span>
          </div>
        </div>
      </Footer>

      <Modal
        title={selectedPet ? `${selectedPet.owner_name}的宠物 - ${selectedPet.name}` : '宠物详情'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={isMobile ? '95%' : 900}
        centered={isMobile}
      >
        <Spin spinning={loadingPetDetail}>
          {selectedPet && (
            <div>
              <Row gutter={[24, 24]}>
                <Col xs={24} md={8}>
                  <div style={{ 
                    height: 300, 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    background: 'linear-gradient(to bottom, #f5f7fa 0%, #c3cfe2 100%)', 
                    borderRadius: 12,
                    padding: 20
                  }}>
                    <img 
                      alt={selectedPet.name} 
                      src={(() => {
                        try {
                          const urls = typeof selectedPet.image_urls === 'string' ? JSON.parse(selectedPet.image_urls) : selectedPet.image_urls;
                          return urls[selectedPet.growth_stage] || urls['成年期'] || Object.values(urls)[0] || '';
                        } catch (e) {
                          return selectedPet.image_urls;
                        }
                      })()} 
                      style={{ 
                        maxHeight: '100%', 
                        maxWidth: '100%', 
                        objectFit: 'contain', 
                        filter: 'drop-shadow(0 10px 8px rgba(0,0,0,0.2))' 
                      }} 
                    />
                  </div>
                  <div style={{ textAlign: 'center', marginTop: 16 }}>
                    <h3 style={{ margin: 0 }}>{selectedPet.name}</h3>
                    <p style={{ color: '#8c8c8c', margin: '4px 0' }}>
                      {selectedPet.species_name} · {selectedPet.growth_stage}
                    </p>
                  </div>
                </Col>
                <Col xs={24} md={16}>
                  <Row gutter={[16, 16]}>
                    <Col xs={12}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="等级" 
                          value={selectedPet.level} 
                          suffix="级"
                          valueStyle={{ color: '#1890ff', fontSize: 24, fontWeight: 'bold' }}
                        />
                      </Card>
                    </Col>
                    <Col xs={12}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="经验值" 
                          value={selectedPet.exp} 
                          suffix="EXP"
                          valueStyle={{ color: '#52c41a', fontSize: 24, fontWeight: 'bold' }}
                        />
                      </Card>
                    </Col>
                    <Col xs={8}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="攻击力" 
                          value={selectedPet.attack} 
                          valueStyle={{ color: '#ff4d4f', fontSize: 20, fontWeight: 'bold' }}
                        />
                        {petBonus?.attack > 0 && (
                          <div style={{ fontSize: 12, color: '#52c41a', marginTop: 4 }}>+{petBonus.attack} 装备加成</div>
                        )}
                      </Card>
                    </Col>
                    <Col xs={8}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="防御力" 
                          value={selectedPet.defense} 
                          valueStyle={{ color: '#1890ff', fontSize: 20, fontWeight: 'bold' }}
                        />
                        {petBonus?.defense > 0 && (
                          <div style={{ fontSize: 12, color: '#52c41a', marginTop: 4 }}>+{petBonus.defense} 装备加成</div>
                        )}
                      </Card>
                    </Col>
                    <Col xs={8}>
                      <Card size="small" style={{ borderRadius: 8 }}>
                        <Statistic 
                          title="速度" 
                          value={selectedPet.speed} 
                          valueStyle={{ color: '#faad14', fontSize: 20, fontWeight: 'bold' }}
                        />
                        {petBonus?.speed > 0 && (
                          <div style={{ fontSize: 12, color: '#52c41a', marginTop: 4 }}>+{petBonus.speed} 装备加成</div>
                        )}
                      </Card>
                    </Col>
                  </Row>

                  {petEquipments.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <h4 style={{ marginBottom: 12 }}>当前穿戴</h4>
                      <Row gutter={[12, 12]}>
                        {petEquipments.map((eq, idx) => (
                          <Col xs={12} key={idx}>
                            <Card 
                              size="small" 
                              style={{ borderRadius: 8, background: '#fafafa' }}
                            >
                              <div style={{ fontWeight: 'bold' }}>{eq.name}</div>
                              <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                {eq.rarity === 'common' ? '普通' : eq.rarity === 'rare' ? '稀有' : eq.rarity === 'epic' ? '史诗' : eq.rarity} · Lv.{eq.level}
                              </div>
                            </Card>
                          </Col>
                        ))}
                      </Row>
                    </div>
                  )}
                </Col>
              </Row>
            </div>
          )}
        </Spin>
      </Modal>
      
      {/* 新手引导弹窗 */}
      <Modal
        title="🎮 新手引导"
        open={newbieGuideVisible}
        onCancel={() => {
          // 不允许关闭，必须完成引导
          message.info('请完成新手引导后继续使用');
        }}
        footer={[
          <Button key="next" type="primary" onClick={handleNewbieNextStep}>
            {newbieStep === 0 ? '创建宠物' : newbieStep < 3 ? '下一步' : '完成引导'}
          </Button>
        ]}
        width={isMobile ? '95vw' : 700}
        closable={false}
        maskClosable={false}
      >
        <Steps current={newbieStep} style={{ marginBottom: 24 }}>
          <Steps.Step title="选择宠物" />
          <Steps.Step title="完成练习" />
          <Steps.Step title="投喂宠物" />
          <Steps.Step title="查看排行" />
        </Steps>
        
        {newbieStep === 0 && (
          <div>
            <h3>第一步：选择你的宠物伙伴</h3>
            <p style={{ color: '#666', marginBottom: 16 }}>
              选择一只宠物陪伴你学习，完成作业可以获得经验值让宠物成长！
            </p>
            <CreatePet onSuccess={handleNewbiePetCreated} />
          </div>
        )}
        
        {newbieStep === 1 && (
          <div>
            <h3>第二步：完成一道示例练习题</h3>
            <p style={{ color: '#666', marginBottom: 16 }}>
              这是一道示例题，不计入成绩，让你体验作业系统的使用方式。
            </p>
            <Alert
              type="info"
              message="提示"
              description={"点击左侧菜单的'作业'选项，完成任意一道练习题即可。系统会赠送你初始道具。"}
              showIcon
              style={{ marginBottom: 16 }}
            />
          </div>
        )}
        
        {newbieStep === 2 && (
          <div>
            <h3>第三步：投喂你的宠物</h3>
            <p style={{ color: '#666', marginBottom: 16 }}>
              系统已经赠送你3个初始道具，现在去投喂你的宠物吧！
            </p>
            <Alert
              type="success"
              message="提示"
              description={"点击左侧菜单的'我的宠物'，然后点击'喂食'按钮，使用道具投喂宠物。"}
              showIcon
              style={{ marginBottom: 16 }}
            />
            {guidePetData && (
              <Card size="small" style={{ marginBottom: 16 }}>
                <div style={{ textAlign: 'center' }}>
                  <img 
                    src={(() => {
                      try {
                        const urls = typeof guidePetData.image_urls === 'string' ? JSON.parse(guidePetData.image_urls) : guidePetData.image_urls;
                        return urls[guidePetData.growth_stage] || urls['宠物蛋'] || Object.values(urls)[0] || '';
                      } catch (e) {
                        return '';
                      }
                    })()} 
                    alt={guidePetData.name} 
                    style={{ width: 100, height: 100, objectFit: 'contain' }} 
                  />
                  <h4>{guidePetData.name}</h4>
                  <p>等级: Lv.{guidePetData.level}</p>
                </div>
              </Card>
            )}
          </div>
        )}
        
        {newbieStep === 3 && (
          <div>
            <h3>第四步：查看排行榜</h3>
            <p style={{ color: '#666', marginBottom: 16 }}>
              排行榜显示了全班宠物的等级排名，努力学习让你的宠物变得更强吧！
            </p>
            <Alert
              type="warning"
              message="提示"
              description={"首页的'本班宠物排行'标签页可以看到排行榜。完成作业、战斗胜利都能获得经验值提升等级。"}
              showIcon
              style={{ marginBottom: 16 }}
            />
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default Home;
