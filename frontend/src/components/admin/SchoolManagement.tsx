import React, { useEffect, useState } from 'react';
import { Table, Button, Form, Input, message, Space, Modal, Popconfirm } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { schoolAPI } from '../../utils/api';
import { useTablePagination } from './hooks';

const SchoolManagement: React.FC = () => {
  const pagination = useTablePagination();
  const [schools, setSchools] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSchool, setEditingSchool] = useState<any>(null);
  const [form] = Form.useForm();

  useEffect(() => { loadSchools(); }, []);

  const loadSchools = async () => {
    setLoading(true);
    try {
      const res = await schoolAPI.getSchools();
      setSchools(res.data.schools || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载学校列表失败');
    } finally { setLoading(false); }
  };

  const openCreate = () => {
    setEditingSchool(null);
    form.resetFields();
    form.setFieldsValue({ theme_color: '#1677ff' });
    setModalVisible(true);
  };

  const openEdit = (record: any) => {
    setEditingSchool(record);
    form.setFieldsValue({
      name: record.name,
      city: record.city,
      region: record.region,
      theme_color: record.theme_color || '#1677ff',
      logo: record.logo || '',
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingSchool) {
        await schoolAPI.updateSchool(editingSchool.id, values);
        message.success('学校更新成功');
      } else {
        await schoolAPI.createSchool(values);
        message.success('学校创建成功');
      }
      setModalVisible(false);
      form.resetFields();
      loadSchools();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.response?.data?.error || '操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await schoolAPI.deleteSchool(id);
      message.success('学校已删除');
      loadSchools();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '城市', dataIndex: 'city', key: 'city', render: (v: string) => v || '-' },
    { title: '区域', dataIndex: 'region', key: 'region', render: (v: string) => v || '-' },
    { title: '主题色', dataIndex: 'theme_color', key: 'theme_color', render: (v: string) => v
      ? <Space><span style={{ display: 'inline-block', width: 16, height: 16, background: v, borderRadius: 3, border: '1px solid #eee' }} /><span>{v}</span></Space>
      : '-' },
    { title: '班级数', dataIndex: 'class_count', key: 'class_count' },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="删除后不可恢复，仅在该学校下无班级时才能删除。确认删除？"
            onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建学校</Button>
      </div>
      <Table columns={columns} dataSource={schools} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal
        title={editingSchool ? '编辑学校' : '新建学校'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="学校名称" rules={[{ required: true, message: '请输入学校名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="city" label="城市"><Input /></Form.Item>
          <Form.Item name="region" label="区域"><Input /></Form.Item>
          <Form.Item name="theme_color" label="主题色">
            <Input type="color" style={{ width: 120, padding: 2 }} />
          </Form.Item>
          <Form.Item name="logo" label="Logo URL"><Input placeholder="https://..." /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export { SchoolManagement };
export default SchoolManagement;
