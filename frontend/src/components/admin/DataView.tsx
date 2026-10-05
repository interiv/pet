import React, { useEffect, useState } from 'react';
import { Table, Button, Tabs, message, Tag, Space, Modal, Popconfirm, Alert } from 'antd';
import { DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { adminAPI, assignmentAPI } from '../../utils/api';
import { useAuthStore } from '../../store/authStore';
import { useTablePagination } from './hooks';
import { questionTypeLabel } from '../../utils/questionTypes';

const DataView: React.FC = () => {
  const { user } = useAuthStore();
  const battlePagination = useTablePagination();
  const assignmentPagination = useTablePagination();
  const shopPagination = useTablePagination();
  const [battles, setBattles] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [shopRecords, setShopRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('assignments');
  const [questionModalVisible, setQuestionModalVisible] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<any>(null);
  const [assignmentQuestions, setAssignmentQuestions] = useState<any[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isHeadTeacher = user?.role === 'teacher' && (user as any).teacher_classes?.some(
    (c: any) => c.class_role === 'head_teacher'
  );

  const canViewBattles = isAdmin || isHeadTeacher;
  const canViewShop = isAdmin || isHeadTeacher;

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'battles' && !canViewBattles) {
      setActiveTab('assignments');
    }
    if (activeTab === 'shop' && !canViewShop) {
      setActiveTab('assignments');
    }
  }, [canViewBattles, canViewShop]);

  const loadData = async () => {
    setLoading(true);
    try {
      const promises: Promise<any>[] = [];
      if (canViewBattles) promises.push(adminAPI.getBattles());
      promises.push(adminAPI.getAssignments());
      if (canViewShop) promises.push(adminAPI.getShopRecords());

      const results = await Promise.all(promises);
      let idx = 0;
      if (canViewBattles) {
        setBattles(results[idx].data.battles || []);
        idx++;
      }
      setAssignments(results[idx].data.assignments || []);
      idx++;
      if (canViewShop) {
        setShopRecords(results[idx].data.records || []);
      }
    } catch (error: any) {
      if (error?.response?.status === 403) {
        message.warning('部分数据无权查看');
      } else {
        message.error('加载数据失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleViewQuestions = async (record: any) => {
    setSelectedAssignment(record);
    setQuestionModalVisible(true);
    setQuestionsLoading(true);
    try {
      const res = await assignmentAPI.getAssignment(record.id);
      setAssignmentQuestions(res.data.assignment?.questions || []);
    } catch (e: any) {
      message.error('加载题目失败');
    } finally {
      setQuestionsLoading(false);
    }
  };

  const handleDeleteAssignment = async (id: number) => {
    try {
      await adminAPI.deleteAssignment(id);
      message.success('作业及相关数据已彻底删除');
      loadData();
    } catch (e: any) {
      message.error(e.response?.data?.error || '删除失败');
    }
  };

  const handleDeleteQuestion = async (questionId: number) => {
    if (!selectedAssignment) return;
    try {
      await adminAPI.deleteAssignmentQuestion(selectedAssignment.id, questionId);
      message.success('题目及相关记录已删除');
      handleViewQuestions(selectedAssignment);
      loadData();
    } catch (e: any) {
      message.error(e.response?.data?.error || '删除题目失败');
    }
  };

  const battleColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '挑战者', dataIndex: 'challenger_name', key: 'challenger_name' },
    { title: '应战者', dataIndex: 'defender_name', key: 'defender_name' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '-' },
    { title: '结果', dataIndex: 'winner_id', key: 'winner_id', render: (v: number, record: any) => v === record.pet1_id ? '挑战者胜' : v === record.pet2_id ? '应战者胜' : '-' },
    { title: '时间', dataIndex: 'battle_date', key: 'battle_date', render: (v: string) => new Date(v).toLocaleString() },
  ];

  const assignmentColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '创建人', dataIndex: 'creator_name', key: 'creator_name' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '-' },
    { title: '科目', dataIndex: 'subject', key: 'subject', render: (v: string) => v ? <Tag color="blue">{v}</Tag> : '-' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        if (status === 'cancelled') return <Tag color="default">已取消</Tag>;
        return <Tag color="green">进行中</Tag>;
      }
    },
    { title: '经验奖励', dataIndex: 'max_exp', key: 'max_exp' },
    { title: '截止日期', dataIndex: 'due_date', key: 'due_date', render: (v: string) => v ? new Date(v).toLocaleDateString() : '-' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewQuestions(record)}>查看题目</Button>
          {record.status === 'cancelled' && isAdmin && (
            <Popconfirm
              title="确认彻底删除此作业？"
              description="将删除作业、题目、提交记录、错题本等所有相关数据，不可恢复"
              onConfirm={() => handleDeleteAssignment(record.id)}
              okText="确认删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const shopColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '购买者', dataIndex: 'buyer_name', key: 'buyer_name' },
    { title: '商品', dataIndex: 'item_name', key: 'item_name' },
    { title: '稀有度', dataIndex: 'rarity', key: 'rarity', render: (v: string) => <Tag color={
      v === 'legendary' ? 'gold' : v === 'epic' ? 'purple' : v === 'rare' ? 'blue' : v === 'uncommon' ? 'green' : 'default'
    }>{v}</Tag> },
    { title: '数量', dataIndex: 'quantity', key: 'quantity' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '-' },
    { title: '时间', dataIndex: 'obtained_at', key: 'obtained_at', render: (v: string) => new Date(v).toLocaleString() },
  ];

  const dataViewTabItems = [
    ...(canViewBattles ? [{ key: 'battles', label: '战斗记录', children: <Table dataSource={battles} columns={battleColumns} rowKey="id" loading={loading} pagination={battlePagination} size="small" scroll={{ x: true }} /> }] : []),
    { key: 'assignments', label: '作业记录', children: <Table dataSource={assignments} columns={assignmentColumns} rowKey="id" loading={loading} pagination={assignmentPagination} size="small" scroll={{ x: true }} /> },
    ...(canViewShop ? [{ key: 'shop', label: '购买记录', children: <Table dataSource={shopRecords} columns={shopColumns} rowKey="id" loading={loading} pagination={shopPagination} size="small" scroll={{ x: true }} /> }] : []),
  ];

  return (
    <div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={dataViewTabItems} />

      <Modal
        title={`题目详情 - ${selectedAssignment?.title || ''}`}
        open={questionModalVisible}
        onCancel={() => { setQuestionModalVisible(false); setSelectedAssignment(null); setAssignmentQuestions([]); }}
        width={700}
        footer={<Button onClick={() => setQuestionModalVisible(false)}>关闭</Button>}
      >
        {selectedAssignment?.status === 'cancelled' && isAdmin && (
          <Alert
            type="warning"
            showIcon
            message="此作业已取消，管理员可以删除其中的题目（将同时删除相关错题本、答题记录等）"
            style={{ marginBottom: 16 }}
          />
        )}
        <Table
          dataSource={assignmentQuestions}
          rowKey="id"
          loading={questionsLoading}
          pagination={false}
          size="small"
          columns={[
            { title: '#', render: (_: any, __: any, i: number) => i + 1, width: 40 },
            { title: '题型', dataIndex: 'type', key: 'type', width: 80, render: (t: string) => (
              <Tag>{questionTypeLabel(t)}</Tag>
            )},
            { title: '题目内容', dataIndex: 'content', key: 'content', render: (c: string) => (
              <div style={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</div>
            )},
            { title: '知识点', dataIndex: 'knowledge_point', key: 'knowledge_point', width: 140, render: (kp: string) => kp ? <Tag color="blue">{kp}</Tag> : '-' },
            ...(selectedAssignment?.status === 'cancelled' && isAdmin ? [{
              title: '操作',
              key: 'action',
              width: 80,
              render: (_: any, record: any) => (
                <Popconfirm
                  title="确认删除此题目？"
                  description="将同时删除相关答题记录、错题本记录等"
                  onConfirm={() => handleDeleteQuestion(record.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              ),
            }] : []),
          ]}
        />
      </Modal>
    </div>
  );
};

export { DataView };
export default DataView;
