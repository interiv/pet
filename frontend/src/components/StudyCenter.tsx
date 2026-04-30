import React, { useState } from 'react';
import { Tabs } from 'antd';
import { BookOutlined, ExclamationCircleOutlined, FireOutlined } from '@ant-design/icons';
import Assignments from './Assignments';
import WrongQuestions from './WrongQuestions';
import DailyTasks from './DailyTasks';

interface StudyCenterProps {
  defaultTab?: 'assignments' | 'wrong' | 'daily';
  onNavigate?: (menu: string) => void;
}

const StudyCenter: React.FC<StudyCenterProps> = ({ defaultTab = 'assignments', onNavigate }) => {
  const [activeTab, setActiveTab] = useState(defaultTab);

  const items = [
    {
      key: 'assignments',
      label: '作业',
      icon: <BookOutlined />,
      children: <Assignments onNavigate={onNavigate} />,
    },
    {
      key: 'wrong',
      label: '错题本',
      icon: <ExclamationCircleOutlined />,
      children: <WrongQuestions />,
    },
    {
      key: 'daily',
      label: '每日任务',
      icon: <FireOutlined />,
      children: <DailyTasks />,
    },
  ];

  return (
    <Tabs
      activeKey={activeTab}
      onChange={(key) => setActiveTab(key as 'assignments' | 'wrong' | 'daily')}
      items={items}
    />
  );
};

export default StudyCenter;
