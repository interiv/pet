import React, { useEffect, useState } from 'react';
import { Tabs } from 'antd';
import { UserOutlined, TeamOutlined, FolderOutlined, NotificationOutlined, DatabaseOutlined, GlobalOutlined, ThunderboltOutlined, RobotOutlined, BankOutlined, TrophyOutlined, LineChartOutlined, ClearOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';
import { useMobile } from './admin/hooks';
import Dashboard from './admin/Dashboard';
import ApplicationManagement from './admin/ApplicationManagement';
import TeacherManagement from './admin/TeacherManagement';
import StudentManagement from './admin/StudentManagement';
import ClassManagement from './admin/ClassManagement';
import SchoolManagement from './admin/SchoolManagement';
import AnnouncementManagement from './admin/AnnouncementManagement';
import SiteSettings from './admin/SiteSettings';
import AISettings from './admin/AISettings';
import TokenDashboard from './admin/TokenDashboard';
import DataView from './admin/DataView';
import CleanData from './admin/CleanData';
import SystemData from './admin/SystemData';
import SoftwareUpdate from './admin/SoftwareUpdate';
import ClassInvitationManager from './ClassInvitationManager';
import AchievementManagement from './admin/AchievementManagement';

interface AdminProps {
  defaultTab?: string;
}

const Admin: React.FC<AdminProps> = ({ defaultTab }) => {
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [activeTab, setActiveTab] = useState(defaultTab || 'dashboard');
  // 从其他页签跳转到「申请审批」时携带的预设（默认子页签 / 默认状态筛选）
  const [approvalPreset, setApprovalPreset] = useState<{ role?: 'teacher' | 'student'; status?: string } | null>(null);

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';

  // 跳转到「申请审批」页签（可指定落到教师申请/学生申请）
  const goToApproval = (role: 'teacher' | 'student' = 'teacher', status?: string) => {
    setApprovalPreset({ role, status });
    setActiveTab('applications');
  };

  // 手动切换页签时清掉跳转预设，避免下次进入时还带着旧筛选
  const handleTabChange = (key: string) => {
    setApprovalPreset(null);
    setActiveTab(key);
  };

  const getTabItems = () => {
    if (isAdmin) {
      return [
        { key: 'dashboard', label: <span><TeamOutlined /> 总览</span>, children: <Dashboard /> },
        { key: 'teachers', label: <span><UserOutlined /> 教师管理</span>, children: <TeacherManagement onGoApprove={() => goToApproval('teacher', 'pending')} /> },
        { key: 'students', label: <span><TeamOutlined /> 学生管理</span>, children: <StudentManagement /> },
        { key: 'classes', label: <span><FolderOutlined /> 班级管理</span>, children: <ClassManagement /> },
        { key: 'schools', label: <span><BankOutlined /> 学校管理</span>, children: <SchoolManagement /> },
        {
          key: 'applications',
          label: <span><TeamOutlined /> 申请审批</span>,
          children: <ApplicationManagement initialRole={approvalPreset?.role} initialStatus={approvalPreset?.status} />
        },
        { key: 'announcements', label: <span><NotificationOutlined /> 公告管理</span>, children: <AnnouncementManagement /> },
        { key: 'dataview', label: <span><DatabaseOutlined /> 数据查看</span>, children: <DataView /> },
        { key: 'site_settings', label: <span><GlobalOutlined /> 网站设置</span>, children: <SiteSettings /> },
        { key: 'ai_settings', label: <span><RobotOutlined /> AI设置</span>, children: <AISettings /> },
        { key: 'token_dashboard', label: <span><LineChartOutlined /> Token看板</span>, children: <TokenDashboard /> },
        { key: 'achievements', label: <span><TrophyOutlined /> 成就管理</span>, children: <AchievementManagement /> },
        { key: 'clean_data', label: <span><ClearOutlined /> 清理数据</span>, children: <CleanData /> },
        { key: 'system', label: <span><ThunderboltOutlined /> 系统数据</span>, children: <SystemData /> },
        { key: 'software_update', label: <span><CloudUploadOutlined /> 软件升级</span>, children: <SoftwareUpdate /> },
        // 「个人中心」不在这里重复一份：左侧菜单和右上角头像下拉已经有了（见 Home.tsx）
      ];
    } else if (isTeacher) {
      const isHeadTeacher = (user as any).teacher_classes?.some((c: any) => c.class_role === 'head_teacher');
      const items = [
        { key: 'dashboard', label: <span><TeamOutlined /> 总览</span>, children: <Dashboard /> },
        { key: 'students', label: <span><TeamOutlined /> 学生管理</span>, children: <StudentManagement /> },
        { key: 'classes', label: <span><FolderOutlined /> 班级管理</span>, children: <ClassManagement /> },
      ];
      if (isHeadTeacher) {
        items.push(
          { key: 'class-invitation', label: <span><TeamOutlined /> 邀请设置</span>, children: <ClassInvitationManager /> },
          { key: 'applications', label: <span><TeamOutlined /> 申请审批</span>, children: <ApplicationManagement /> },
        );
      }
      items.push(
        { key: 'dataview', label: <span><DatabaseOutlined /> 数据查看</span>, children: <DataView /> },
        // 同上：个人中心统一走左侧菜单，工作台不再重复挂一份
      );
      return items;
    }
    return [];
  };

  // URL 里可能带着早已删除的页签（如旧书签 tab=profile），回退到第一个可用页签，避免白屏
  const tabItems = getTabItems();
  useEffect(() => {
    if (tabItems.length > 0 && !tabItems.some((t: any) => t.key === activeTab)) {
      setActiveTab(tabItems[0].key);
    }
  }, [activeTab, tabItems.map((t: any) => t.key).join(',')]);

  const getTitle = () => {
    if (isAdmin) return '管理控制台';
    if (isTeacher) return '教师工作台';
    return '控制台';
  };

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <h2 style={{ marginBottom: isMobile ? 16 : 24 }}>{getTitle()}</h2>
      {/* destroyOnHidden：切换页签时重新挂载，确保每次进入都拉取最新数据（避免跨页签数据不更新的问题） */}
      <Tabs activeKey={activeTab} onChange={handleTabChange} items={tabItems} destroyOnHidden />
    </div>
  );
};

export default Admin;
