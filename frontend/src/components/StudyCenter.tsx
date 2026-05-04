import React from 'react';
import { Tabs } from 'antd';
import { BookOutlined, ExclamationCircleOutlined, FireOutlined, BarChartOutlined, EyeOutlined, CrownOutlined, TrophyOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import Assignments from './Assignments';
import WrongQuestions from './WrongQuestions';
import DailyTasks from './DailyTasks';
import ClassDashboard from './ClassDashboard';
import { ClassTeachingOverview } from './Admin';
import BossBattleManager from './BossBattleManager';
import Achievements from './Achievements';
import LearningDashboard from './LearningDashboard';
import QuestionBank from './QuestionBank';
import { useAuthStore } from '../store/authStore';

interface StudyCenterProps {
  onNavigate?: (menu: string) => void;
}

const StudyCenter: React.FC<StudyCenterProps> = ({ onNavigate }) => {
  const { user } = useAuthStore();
  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || (isTeacher ? 'assignments' : 'assignments');

  const handleTabChange = (key: string) => {
    setSearchParams(prev => {
      prev.set('tab', key);
      prev.delete('sub');
      return prev;
    }, { replace: true });
  };

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
      key: 'boss',
      label: 'BOSS战管理',
      icon: <CrownOutlined />,
      children: <BossBattleManager />,
    },
    {
      key: 'question-bank',
      label: '题库',
      icon: <BookOutlined />,
      children: <QuestionBank />,
    },
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
      onChange={handleTabChange}
      items={isTeacher ? teacherItems : studentItems}
    />
  );
};

export default StudyCenter;
