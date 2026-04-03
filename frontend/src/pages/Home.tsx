import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Card, Row, Col, Statistic, Tabs, TabsProps, Modal, Spin, Table, Segmented, Drawer, Button } from 'antd';
import {
  HomeOutlined,
  BookOutlined,
  TrophyOutlined,
  UserOutlined,
  LogoutOutlined,
  DashboardOutlined,
  SettingOutlined,
  TeamOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
  BellOutlined,
  NotificationOutlined,
  MenuOutlined,
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

const { Header, Content, Sider } = Layout;

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

  const [activeMenu, setActiveMenu] = useState('home');
  const [leaderboard, setLeaderboard] = useState([]);
  const [allPets, setAllPets] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedPet, setSelectedPet] = useState<any>(null);
  const [loadingPetDetail, setLoadingPetDetail] = useState(false);
  const [petEquipments, setPetEquipments] = useState<any[]>([]);
  const [petBonus, setPetBonus] = useState<any>(null);
  const [leaderboardView, setLeaderboardView] = useState<'card' | 'list'>('card');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      loadPetData();
      loadLeaderboard();
      if (user?.role === 'admin') {
        loadAllPets();
      } else {
        loadMyClassPets();
      }
    }
  }, [isAuthenticated, user]);

  const loadMyClassPets = async () => {
    try {
      const res = await adminAPI.getClasses();
      const classes = res.data.classes || [];
      if (classes.length > 0) {
        loadAllPets(classes[0].id);
      } else {
        setAllPets([]);
      }
    } catch (error) {
      console.error('加载班级宠物失败:', error);
    }
  };

  const loadAllPets = async (classId?: number) => {
    try {
      const params = classId ? { class_id: classId } : {};
      const response = await petAPI.getAllPets(params);
      setAllPets(response.data.pets || []);
    } catch (error) {
      console.error('加载宠物列表失败:', error);
    }
  };

  const loadPetData = async () => {
    try {
      const response = await petAPI.getMyPet();
      setPet(response.data.pet);
    } catch (error) {
      console.log('还没有宠物');
    }
  };

  const loadLeaderboard = async () => {
    try {
      const response = await leaderboardAPI.getLevelLeaderboard();
      setLeaderboard(response.data.leaderboard);
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

  const menuItems = [
    {
      key: 'home',
      icon: <HomeOutlined />,
      label: '首页',
    },
    {
      key: 'pet',
      icon: <HomeOutlined />,
      label: '我的宠物',
    },
    {
      key: 'assignment',
      icon: <BookOutlined />,
      label: '作业',
    },
    {
      key: 'wrong_questions',
      icon: <ExclamationCircleOutlined />,
      label: '错题本',
    },
    {
      key: 'battle',
      icon: <TrophyOutlined />,
      label: '战斗',
    },
    {
      key: 'shop',
      icon: <DashboardOutlined />,
      label: '商店与背包',
    },
    {
      key: 'friends',
      icon: <UserOutlined />,
      label: '我的好友',
    },
    {
      key: 'achievements',
      icon: <TrophyOutlined />,
      label: '成就',
    },
    {
      key: 'posts',
      icon: <NotificationOutlined />,
      label: '班级动态',
    },
    {
      key: 'chat',
      icon: <MessageOutlined />,
      label: '群聊',
    },
    {
      key: 'forum',
      label: '论坛',
    },
    {
      key: 'notifications',
      icon: <BellOutlined />,
      label: '通知中心',
    },
  ];

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
      label: '入学申请',
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
    { title: '金币', dataIndex: 'gold', key: 'gold' },
    { title: '体力', dataIndex: 'stamina', key: 'stamina' },
    { title: '饱腹度', dataIndex: 'hunger', key: 'hunger' },
    { title: '心情', dataIndex: 'mood', key: 'mood' },
    { title: '健康', dataIndex: 'health', key: 'health' },
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

  const authTabItems: TabsProps['items'] = [
    { key: 'pet', label: '我的宠物', children: hasPet ? <PetDisplay pet={pet} /> : <CreatePet onSuccess={loadPetData} /> },
    { key: 'all_pets', label: user?.role === 'admin' ? '全校宠物' : '全班宠物', children: allPetsChildren },
    { key: 'leaderboard', label: '排行榜', children: leaderboardChildren }
  ];

  const unauthTabItems: TabsProps['items'] = [
    { key: 'all_pets', label: '全校宠物', children: allPetsChildren },
    { key: 'leaderboard', label: '排行榜', children: leaderboardChildren }
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        background: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        zIndex: 1,
        padding: isMobile ? '0 12px' : '0 24px',
        height: isMobile ? 56 : 64,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20 }}>
          {isMobile && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              size="large"
            />
          )}
          <span style={{ fontSize: isMobile ? 20 : 24 }}>🐾</span>
          <span style={{ fontSize: isMobile ? 14 : 18, fontWeight: 'bold', display: isMobile ? 'none' : 'block' }}>班级宠物养成系统</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16 }}>
          {isAuthenticated ? (
            <>
              {!isMobile && <span style={{ color: '#666' }}>欢迎，{user?.username}</span>}
              {isMobile && <span style={{ color: '#666', fontSize: 13, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.username}</span>}
              <Dropdown menu={userMenu} placement="bottomRight">
                <Avatar 
                  size={isMobile ? 32 : 40} 
                  icon={<UserOutlined />} 
                  src={user?.avatar}
                  style={{ cursor: 'pointer', background: '#87d068' }}
                />
              </Dropdown>
            </>
          ) : (
            <div style={{ display: 'flex', gap: isMobile ? 8 : 10 }}>
              <a onClick={() => navigate('/login')} style={{ color: '#1890ff', fontSize: isMobile ? 13 : undefined }}>登录</a>
              <a onClick={() => navigate('/register')} style={{ color: '#1890ff', fontSize: isMobile ? 13 : undefined }}>注册</a>
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
                  <Assignments />
                ) : activeMenu === 'wrong_questions' ? (
                  <WrongQuestions />
                ) : activeMenu === 'battle' ? (
                  <Battle />
                ) : activeMenu === 'shop' ? (
                  <ShopAndBackpack />
                ) : activeMenu === 'friends' ? (
                  <Friends />
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
                ) : activeMenu === 'profile' ? (
                  <Profile />
                ) : isAuthenticated ? (
                  <Tabs 
                    activeKey={['home', 'pet', 'all_pets', 'leaderboard'].includes(activeMenu) ? activeMenu === 'home' ? 'pet' : activeMenu : 'pet'} 
                    onChange={(key) => setActiveMenu(key)}
                    items={authTabItems}
                    size={isMobile ? 'small' : 'middle'}
                    centered={isMobile}
                  />
                ) : (
                  <Tabs 
                    activeKey={['all_pets', 'leaderboard'].includes(activeMenu) ? activeMenu : 'all_pets'} 
                    onChange={(key) => setActiveMenu(key)}
                    items={unauthTabItems}
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
                  <Assignments />
                ) : activeMenu === 'wrong_questions' ? (
                  <WrongQuestions />
                ) : activeMenu === 'battle' ? (
                  <Battle />
                ) : activeMenu === 'shop' ? (
                  <ShopAndBackpack />
                ) : activeMenu === 'friends' ? (
                  <Friends />
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
                ) : activeMenu === 'profile' ? (
                  <Profile />
                ) : isAuthenticated ? (
                  <Tabs 
                    activeKey={['home', 'pet', 'all_pets', 'leaderboard'].includes(activeMenu) ? activeMenu === 'home' ? 'pet' : activeMenu : 'pet'} 
                    onChange={(key) => setActiveMenu(key)}
                    items={authTabItems}
                  />
                ) : (
                  <Tabs 
                    activeKey={['all_pets', 'leaderboard'].includes(activeMenu) ? activeMenu : 'all_pets'} 
                    onChange={(key) => setActiveMenu(key)}
                    items={unauthTabItems}
                  />
                )}
              </div>
            </Content>
          </>
        )}
      </Layout>

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
    </Layout>
  );
};

export default Home;
