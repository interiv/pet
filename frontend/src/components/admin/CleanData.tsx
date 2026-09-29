import React, { useState } from 'react';
import { Card, Button, Input, message, Alert, Divider } from 'antd';
import { ClearOutlined } from '@ant-design/icons';
import { adminAPI } from '../../utils/api';

const CleanData: React.FC = () => {
  const [cleaning, setCleaning] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const handleClean = async () => {
    if (confirmText !== '确认清理') {
      message.error('请输入"确认清理"以确认操作');
      return;
    }
    setCleaning(true);
    try {
      await adminAPI.cleanAllData();
      message.success('所有数据已清理，仅保留 admin 账号');
      setConfirmText('');
      setTimeout(() => window.location.reload(), 1500);
    } catch (error: any) {
      message.error(error?.response?.data?.error || '清理数据失败');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Card>
      <Alert
        message="危险操作"
        description="此操作将清理所有业务数据（用户、班级、宠物、作业、战斗、好友、动态等），仅保留 admin 账号和基础配置数据（宠物种类、物品、装备、技能、题库、成就定义等）。此操作不可撤销！"
        type="warning"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <h4>清理范围包括：</h4>
      <ul>
        <li>所有用户（admin 除外）、学校、班级</li>
        <li>所有宠物、装备、物品、技能</li>
        <li>所有作业、提交、答题记录</li>
        <li>所有战斗记录、好友、动态、评论</li>
        <li>所有聊天消息、通知、公告</li>
        <li>所有班级申请、邀请码</li>
        <li>所有任务进度、成就进度、错题本</li>
        <li>所有金币交易、用户活动记录</li>
        <li>所有论坛帖子、Boss 战斗数据</li>
      </ul>

      <h4 style={{ marginTop: 24 }}>保留数据：</h4>
      <ul>
        <li>admin 管理员账号</li>
        <li>宠物种类、物品、装备、技能等基础配置</li>
        <li>题库、成就定义等系统数据</li>
      </ul>

      <Divider />

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
          请输入 <span style={{ color: '#ff4d4f' }}>"确认清理"</span> 以确认操作：
        </label>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="确认清理"
          style={{ maxWidth: 300 }}
        />
      </div>

      <Button
        type="primary"
        danger
        icon={<ClearOutlined />}
        loading={cleaning}
        onClick={handleClean}
        disabled={confirmText !== '确认清理'}
      >
        清理所有数据
      </Button>
    </Card>
  );
};

// 学生导入：表头兼容（中文 Excel 表头 / 英文字段名都支持）

export { CleanData };
export default CleanData;
