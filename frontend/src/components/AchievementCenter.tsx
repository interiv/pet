import React from 'react';
import { Tabs } from 'antd';
import { TrophyOutlined, BarChartOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import Achievements from './Achievements';
import LearningDashboard from './LearningDashboard';

const AchievementCenter: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'achievements';

  const handleTabChange = (key: string) => {
    setSearchParams(prev => {
      prev.set('tab', key);
      prev.delete('sub');
      return prev;
    }, { replace: true });
  };

  const items = [
    {
      key: 'achievements',
      label: '成就',
      icon: <TrophyOutlined />,
      children: <Achievements />,
    },
    {
      key: 'learning',
      label: '学习数据',
      icon: <BarChartOutlined />,
      children: <LearningDashboard />,
    },
  ];

  return (
    <Tabs
      activeKey={activeTab}
      onChange={handleTabChange}
      items={items}
    />
  );
};

export default AchievementCenter;
