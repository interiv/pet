import React, { useState } from 'react';
import { Tabs } from 'antd';
import { TrophyOutlined, BarChartOutlined } from '@ant-design/icons';
import Achievements from './Achievements';
import LearningDashboard from './LearningDashboard';

interface AchievementCenterProps {
  defaultTab?: 'achievements' | 'learning';
}

const AchievementCenter: React.FC<AchievementCenterProps> = ({ defaultTab = 'achievements' }) => {
  const [activeTab, setActiveTab] = useState(defaultTab);

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
      onChange={(key) => setActiveTab(key as 'achievements' | 'learning')}
      items={items}
    />
  );
};

export default AchievementCenter;
