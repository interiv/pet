import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Admin from './Admin';
import { useAuthStore } from '../store/authStore';

// 打桩整个 API 层。statistics 的字段结构需覆盖 Dashboard 的取值路径，
// 否则渲染时会因为访问 undefined.students 之类的属性而抛错。
vi.mock('../utils/api', () => {
  const statistics = {
    users: { total: 0, teachers: 0, students: 0 },
    classes: { total: 0 },
    status: { pending_teachers: 0, pending_students: 0 },
    daily: { active_users: 0 },
    top_classes: [],
    top_selling_items: [],
  };
  const ok = () => Promise.resolve({ data: { statistics } });
  const api = new Proxy({}, { get: () => () => ok() });
  return { adminAPI: api, schoolAPI: api, assignmentAPI: api };
});

const setRole = (role: 'admin' | 'teacher', extra: any = {}) => {
  useAuthStore.setState({
    user: { id: 1, username: 'u1', role, ...extra } as any,
    token: 'test-token',
    isAuthenticated: true,
  });
};

beforeEach(() => {
  localStorage.clear();
});

describe('Admin 外壳', () => {
  it('管理员登录时渲染管理控制台与全部页签', async () => {
    setRole('admin');
    render(<Admin />);

    expect(await screen.findByText('管理控制台')).toBeInTheDocument();

    // 14 个页签的标签都要出现（拆分后这些子组件仍能正确装配）
    for (const label of [
      '总览', '教师管理', '学生管理', '班级管理', '学校管理', '申请审批',
      '公告管理', '数据查看', '网站设置', 'AI设置', 'Token看板',
      '成就管理', '清理数据', '系统数据',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('教师登录时渲染教师工作台，且只看到授权的页签', async () => {
    setRole('teacher', { teacher_classes: [] });
    render(<Admin />);

    expect(await screen.findByText('教师工作台')).toBeInTheDocument();
    expect(screen.getByText('总览')).toBeInTheDocument();
    expect(screen.getByText('学生管理')).toBeInTheDocument();

    // 教师不应看到这些管理页签
    expect(screen.queryByText('学校管理')).toBeNull();
    expect(screen.queryByText('网站设置')).toBeNull();
    expect(screen.queryByText('清理数据')).toBeNull();
  });

  it('班主任额外看到邀请设置与申请审批', async () => {
    setRole('teacher', {
      teacher_classes: [{ id: 7, name: '一班', slug: 'c1', class_role: 'head_teacher' }],
    });
    render(<Admin />);

    expect(await screen.findByText('邀请设置')).toBeInTheDocument();
    expect(screen.getByText('申请审批')).toBeInTheDocument();
  });
});
