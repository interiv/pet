import React, { useEffect, useState } from 'react';
import { Table, Button, Form, Input, message, Space, Modal, Select, InputNumber, Popconfirm } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminAPI } from '../../utils/api';
import { useMobile, useTablePagination } from './hooks';

const AnnouncementManagement: React.FC = () => {
  const pagination = useTablePagination();
  const isMobile = useMobile();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<any>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  useEffect(() => {
    loadAnnouncements();
    loadClasses();
  }, []);

  const loadAnnouncements = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getAnnouncements();
      setAnnouncements(res.data.announcements || []);
    } catch (error) {
      message.error('加载公告失败');
    } finally {
      setLoading(false);
    }
  };

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
    } catch (error) {
      console.error('加载班级失败');
    }
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await adminAPI.createAnnouncement(values);
      message.success('公告创建成功');
      setModalVisible(false);
      form.resetFields();
      loadAnnouncements();
    } catch (error) {
      message.error('创建失败');
    }
  };

  const handleEdit = (record: any) => {
    setEditingAnnouncement(record);
    editForm.setFieldsValue(record);
    setEditModalVisible(true);
  };

  const handleUpdate = async () => {
    try {
      const values = await editForm.validateFields();
      await adminAPI.updateAnnouncement(editingAnnouncement.id, values);
      message.success('公告更新成功');
      setEditModalVisible(false);
      loadAnnouncements();
    } catch (error) {
      message.error('更新失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await adminAPI.deleteAnnouncement(id);
      message.success('公告已删除');
      loadAnnouncements();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '发布者', dataIndex: 'publisher_name', key: 'publisher_name' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '全局' },
    { title: '优先级', dataIndex: 'priority', key: 'priority' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该公告？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>发布公告</Button>
      </div>
      <Table columns={columns} dataSource={announcements} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal title="发布公告" open={modalVisible} onOk={handleCreate} onCancel={() => setModalVisible(false)} width={isMobile ? '95vw' : 600}>
        <Form form={form} layout="vertical" initialValues={{ priority: 0 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="class_ids" label="发布范围">
            <Select mode="multiple" allowClear placeholder="选择班级（不选则全局发布）">
              {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} max={10} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑公告" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)} width={isMobile ? '95vw' : 600}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="内容">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="class_id" label="发布范围">
            <Select allowClear placeholder="选择班级">
              {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <InputNumber min={0} max={10} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export { AnnouncementManagement };
export default AnnouncementManagement;
