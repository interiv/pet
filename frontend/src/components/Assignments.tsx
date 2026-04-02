import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Modal, Form, Input, DatePicker, Select, InputNumber, message, Space } from 'antd';
import { assignmentAPI, adminAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import dayjs from 'dayjs';

const { Option } = Select;
const { TextArea } = Input;

const Assignments: React.FC = () => {
  const { user } = useAuthStore();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isSubmitModalVisible, setIsSubmitModalVisible] = useState(false);
  const [currentAssignment, setCurrentAssignment] = useState<any>(null);
  const [form] = Form.useForm();
  const [submitForm] = Form.useForm();

  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (user) {
      loadAssignments();
      if (isAdmin) {
        loadClasses();
      }
    }
  }, [user]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      let allClasses = res.data.classes || [];
      if (!isAdmin) {
        allClasses = allClasses.filter((c: any) =>
          c.teachers?.some((t: any) => t.teacher_id === user?.id)
        );
      }
      setClasses(allClasses);
    } catch (error) {
      console.error('加载班级列表失败');
    }
  };

  const loadAssignments = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const params = selectedClass ? { class_id: selectedClass } : {};
      const res = await assignmentAPI.getAssignments(params);
      setAssignments(res.data.assignments || []);
    } catch (error) {
      console.error('加载作业失败:', error);
      message.error('加载作业失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAssignment = async (values: any) => {
    try {
      const payload = {
        ...values,
        due_date: values.due_date.toISOString(),
        class_id: values.class_id || selectedClass,
        questions: [{ type: values.question_type, content: '请完成以下作业内容' }],
        ai_config: { auto_grade: true }
      };
      await assignmentAPI.createAssignment(payload);
      message.success('作业发布成功！');
      setIsModalVisible(false);
      form.resetFields();
      loadAssignments();
    } catch (error) {
      console.error('发布作业失败:', error);
      message.error('发布作业失败');
    }
  };

  const handleSubmitAssignment = async (values: any) => {
    if (!currentAssignment) return;
    try {
      await assignmentAPI.submitAssignment(currentAssignment.id, { answers: values.answer });
      message.success('作业提交成功！请等待老师或AI批改。');
      setIsSubmitModalVisible(false);
      submitForm.resetFields();
      loadAssignments();
    } catch (error: any) {
      console.error('提交作业失败:', error);
      message.error(error.response?.data?.error || '提交作业失败');
    }
  };

  const columns = [
    {
      title: '作业标题',
      dataIndex: 'title',
      key: 'title',
      render: (text: string) => <a>{text}</a>,
    },
    {
      title: '班级',
      dataIndex: 'class_name',
      key: 'class_name',
      render: (name: string) => name ? <Tag color="green">{name}</Tag> : <Tag>未分班</Tag>,
    },
    {
      title: '科目',
      dataIndex: 'subject',
      key: 'subject',
      render: (subject: string) => <Tag color="blue">{subject}</Tag>,
    },
    {
      title: '发布教师',
      dataIndex: 'teacher_name',
      key: 'teacher_name',
    },
    {
      title: '金币奖励',
      dataIndex: 'max_exp',
      key: 'max_exp',
      render: (exp: number) => <span style={{ color: '#faad14', fontWeight: 'bold' }}>+{exp} 金币</span>,
    },
    {
      title: '截止日期',
      dataIndex: 'due_date',
      key: 'due_date',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space size="middle">
          {!isTeacher && (
            <Button 
              type="primary" 
              size="small" 
              onClick={() => {
                setCurrentAssignment(record);
                setIsSubmitModalVisible(true);
              }}
            >
              去完成
            </Button>
          )}
          {isTeacher && <Button size="small">查看提交</Button>}
        </Space>
      ),
    },
  ];

  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '12px' }}>
        <h3 style={{ color: '#999', marginBottom: 20 }}>未登录无法查看作业</h3>
        <Button type="primary" onClick={() => window.location.href = '/login'}>前往登录</Button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h2>📝 班级作业</h2>
          {isAdmin && (
            <Select
              placeholder="筛选班级"
              allowClear
              style={{ width: 200 }}
              onChange={(value) => {
                setSelectedClass(value);
                loadAssignments();
              }}
              value={selectedClass}
            >
              {classes.map(c => (
                <Option key={c.id} value={c.id}>{c.name}</Option>
              ))}
            </Select>
          )}
        </div>
        {isTeacher && (
          <Button type="primary" onClick={() => setIsModalVisible(true)}>
            发布新作业
          </Button>
        )}
      </div>

      <Table
        columns={columns}
        dataSource={assignments}
        rowKey="id"
        loading={loading}
      />

      <Modal
        title="发布新作业"
        open={isModalVisible}
        onOk={() => form.submit()}
        onCancel={() => setIsModalVisible(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleCreateAssignment}>
          {isAdmin && (
            <Form.Item name="class_id" label="发布到班级" rules={[{ required: true, message: '请选择班级' }]}>
              <Select placeholder="选择班级">
                {classes.map(c => (
                  <Option key={c.id} value={c.id}>{c.name}</Option>
                ))}
              </Select>
            </Form.Item>
          )}
          <Form.Item name="title" label="作业标题" rules={[{ required: true, message: '请输入作业标题' }]}>
            <Input placeholder="例如：第三章数学练习" />
          </Form.Item>
          
          <Form.Item name="subject" label="科目" rules={[{ required: true, message: '请选择科目' }]}>
            <Select placeholder="选择科目">
              <Option value="语文">语文</Option>
              <Option value="数学">数学</Option>
              <Option value="英语">英语</Option>
              <Option value="物理">物理</Option>
              <Option value="化学">化学</Option>
              <Option value="其他">其他</Option>
            </Select>
          </Form.Item>
          
          <Form.Item name="question_type" label="题目类型" rules={[{ required: true, message: '请选择题目类型' }]}>
            <Select placeholder="选择类型">
              <Option value="multiple_choice">选择题</Option>
              <Option value="short_answer">简答题</Option>
              <Option value="essay">作文</Option>
            </Select>
          </Form.Item>

          <Form.Item name="description" label="作业说明" rules={[{ required: true, message: '请输入作业说明' }]}>
            <TextArea rows={4} placeholder="详细的作业要求和说明..." />
          </Form.Item>
          
          <div style={{ display: 'flex', gap: '16px' }}>
            <Form.Item name="max_exp" label="金币奖励" rules={[{ required: true, message: '请设置金币奖励' }]} style={{ flex: 1 }}>
              <InputNumber min={1} max={30} style={{ width: '100%' }} addonAfter="金币" />
            </Form.Item>
            
            <Form.Item name="due_date" label="截止日期" rules={[{ required: true, message: '请选择截止日期' }]} style={{ flex: 1 }}>
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title={`完成作业: ${currentAssignment?.title}`}
        open={isSubmitModalVisible}
        onOk={() => submitForm.submit()}
        onCancel={() => {
          setIsSubmitModalVisible(false);
          submitForm.resetFields();
        }}
        destroyOnClose
        okText="提交答案"
      >
        <div style={{ marginBottom: 20, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>作业说明：</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{currentAssignment?.description}</div>
        </div>

        <Form form={submitForm} layout="vertical" onFinish={handleSubmitAssignment}>
          <Form.Item 
            name="answer" 
            label="你的答案" 
            rules={[{ required: true, message: '请输入你的答案' }]}
          >
            <TextArea 
              rows={8} 
              placeholder="在这里输入你的答案内容..." 
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Assignments;
