import React, { useState } from 'react';
import { Tabs } from 'antd';
import { BookOutlined, ExclamationCircleOutlined, FireOutlined, BarChartOutlined, EyeOutlined } from '@ant-design/icons';
import Assignments from './Assignments';
import WrongQuestions from './WrongQuestions';
import DailyTasks from './DailyTasks';
import ClassDashboard from './ClassDashboard';
import { ClassTeachingOverview } from './Admin';
import { useAuthStore } from '../store/authStore';

interface StudyCenterProps {
  defaultTab?: 'assignments' | 'wrong' | 'daily' | 'dashboard';
  onNavigate?: (menu: string) => void;
}

const StudyCenter: React.FC<StudyCenterProps> = ({ defaultTab = 'assignments', onNavigate }) => {
  const { user } = useAuthStore();
  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';
  const [activeTab, setActiveTab] = useState(defaultTab);

  const studentItems = [
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

  const isHeadTeacher = isTeacher && (user as any).teacher_classes?.some((c: any) => c.class_role === 'head_teacher');

  const teacherItems = [
    {
      key: 'assignments',
      label: '作业管理',
      icon: <BookOutlined />,
      children: <Assignments onNavigate={onNavigate} />,
    },
    ...(isHeadTeacher ? [{
      key: 'class-overview',
      label: '教学总览',
      icon: <EyeOutlined />,
      children: <ClassTeachingOverview />,
    }] : []),
    {
      key: 'dashboard',
      label: '学情看板',
      icon: <BarChartOutlined />,
      children: <ClassDashboard />,
    },
  ];

  return (
    <Tabs
      activeKey={activeTab}
      onChange={(key) => setActiveTab(key as any)}
      items={isTeacher ? teacherItems : studentItems}
    />
  );
};

export default StudyCenter;
