import React, { useEffect, useState } from 'react';
import { Table, Button, Form, Input, message, Tag, Space, Modal, Select, Popconfirm, Switch } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminAPI, schoolAPI } from '../../utils/api';
import { useAuthStore } from '../../store/authStore';
import { useMobile, useTablePagination } from './hooks';

const ClassManagement: React.FC = () => {
  const pagination = useTablePagination();
  const { user } = useAuthStore();
  const isMobile = useMobile();
  const [classes, setClasses] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [addTeacherModalVisible, setAddTeacherModalVisible] = useState(false);
  const [selectedClass, setSelectedClass] = useState<any>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [addTeacherForm] = Form.useForm();

  const isAdmin = user?.role === 'admin';
  const isTeacher = user?.role === 'teacher';

  useEffect(() => {
    loadClasses();
    loadTeachers();
    loadSchools();
  }, []);

  const loadSchools = async () => {
    try {
      const res = await schoolAPI.getSchools();
      setSchools(res.data.schools || []);
    } catch (error) {
      console.error('加载学校列表失败');
    }
  };

  const loadClasses = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getClasses();
      let allClasses = res.data.classes || [];
      if (isTeacher && !isAdmin) {
        allClasses = allClasses.filter((c: any) =>
          c.teachers?.some((t: any) => t.teacher_id === user?.id)
        );
      }
      setClasses(allClasses);
    } catch (error) {
      message.error('加载班级列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTeachers = async () => {
    try {
      const res = await adminAPI.getTeachers({ status: 'active' });
      setTeachers(res.data.teachers || []);
    } catch (error) {
      console.error('加载教师列表失败');
    }
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await adminAPI.createClass(values);
      message.success('班级创建成功');
      setModalVisible(false);
      form.resetFields();
      loadClasses();
    } catch (error) {
      message.error('创建失败');
    }
  };

  const handleEdit = (record: any) => {
    setSelectedClass(record);
    editForm.setFieldsValue({
      name: record.name,
      grade: record.grade,
      description: record.description || '',
      cover_image: record.cover_image || '',
      is_public: !!record.is_public,
      slug: record.slug || '',
      school_id: record.school_id || null,
    });
    setEditModalVisible(true);
  };

  const handleUpdate = async () => {
    try {
      const values = await editForm.validateFields();
      await adminAPI.updateClass(selectedClass.id, values);
      message.success('班级更新成功');
      setEditModalVisible(false);
      loadClasses();
    } catch (error) {
      message.error('更新失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await adminAPI.deleteClass(id);
      message.success('班级已删除');
      loadClasses();
    } catch (error: any) {
      message.error(error.response?.data?.error || '删除失败');
    }
  };

  const handleAddTeacher = async () => {
    try {
      const values = await addTeacherForm.validateFields();
      await adminAPI.addTeacherToClass(selectedClass.id, values);
      message.success('教师已添加到班级');
      setAddTeacherModalVisible(false);
      addTeacherForm.resetFields();
      loadClasses();
    } catch (error: any) {
      message.error(error.response?.data?.error || '添加失败');
    }
  };

  const handleRemoveTeacher = async (classId: number, teacherId: number) => {
    try {
      await adminAPI.removeTeacherFromClass(classId, teacherId);
      message.success('教师已从班级移除');
      loadClasses();
    } catch (error: any) {
      message.error(error.response?.data?.error || '移除失败');
    }
  };

  const openAddTeacherModal = (cls: any) => {
    setSelectedClass(cls);
    loadTeachers();
    setAddTeacherModalVisible(true);
  };

  const isHeadTeacherOf = (cls: any) => {
    return cls.teachers?.some((t: any) => t.teacher_id === user?.id && t.role === 'head_teacher');
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '班级名称', dataIndex: 'name', key: 'name' },
    { title: '年级', dataIndex: 'grade', key: 'grade', render: (v: string) => v || '-' },
    ...(isAdmin ? [{ title: '学校', dataIndex: 'school_name', key: 'school_name', render: (v: string) => v || '-' }] : []),
    { title: '标识(slug)', dataIndex: 'slug', key: 'slug', render: (v: string) => v ? <code>{v}</code> : '-' },
    { title: '公开', dataIndex: 'is_public', key: 'is_public', render: (v: any) => v ? <Tag color="green">公开</Tag> : <Tag>私有</Tag> },
    {
      title: '教师',
      key: 'teachers',
      render: (_: any, record: any) => (
        <div>
          {(record.teachers || []).map((t: any) => (
            <Tag
              key={t.teacher_id}
              closable={(isAdmin || isHeadTeacherOf(record)) && t.role !== 'head_teacher'}
              onClose={() => (isAdmin || isHeadTeacherOf(record)) && t.role !== 'head_teacher' ? handleRemoveTeacher(record.id, t.teacher_id) : undefined}
              color={t.role === 'head_teacher' ? 'blue' : 'default'}
            >
              {t.real_name || t.username} {t.role === 'head_teacher' ? '(班主任)' : ''}
            </Tag>
          ))}
          {(isAdmin || isHeadTeacherOf(record)) && (
            <Button type="link" size="small" onClick={() => openAddTeacherModal(record)}>+ 添加教师</Button>
          )}
        </div>
      )
    },
    { title: '学生数', dataIndex: 'student_count', key: 'student_count' },
    ...(isAdmin ? [{ title: '总经验', dataIndex: 'total_exp', key: 'total_exp' }] : []),
    ...(isAdmin ? [{ title: '金币总数', dataIndex: 'total_gold', key: 'total_gold' }] : []),
    ...(isAdmin ? [{
      title: '操作' as const,
      key: 'action' as const,
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该班级？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    }] : []),
  ];

  return (
    <div>
      {isAdmin && (
        <div style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { loadSchools(); setModalVisible(true); }}>创建班级</Button>
        </div>
      )}
      <Table columns={columns} dataSource={classes} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal title="创建班级" open={modalVisible} onOk={handleCreate} onCancel={() => setModalVisible(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="班级名称" rules={[{ required: true, message: '请输入班级名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="grade" label="年级">
            <Input placeholder="如：高一(1)班" />
          </Form.Item>
          <Form.Item name="school_id" label="所属学校" rules={[{ required: true, message: '请选择所属学校' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="请选择学校"
              options={schools.map((s: any) => ({ value: s.id, label: `${s.name}${s.city ? ` - ${s.city}` : ''}` }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑班级" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)} width={isMobile ? '95vw' : 560}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="班级名称" rules={[{ required: true, message: '请输入班级名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="grade" label="年级">
            <Input />
          </Form.Item>
          <Form.Item name="school_id" label="所属学校" tooltip="用于学生注册时按学校筛选班级">
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择学校"
              options={schools.map((s: any) => ({ value: s.id, label: `${s.name}${s.city ? ` - ${s.city}` : ''}` }))}
            />
          </Form.Item>
          <Form.Item name="description" label="班级简介">
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
          <Form.Item name="cover_image" label="封面图 URL">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="is_public" label="公开班级主页" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="slug"
            label="班级标识 (slug)"
            rules={[
              { pattern: /^[a-z0-9][a-z0-9-]{2,31}$/i, message: '3-32 位字母/数字/连字符，首字符为字母或数字' },
            ]}
          >
            <Input placeholder="例：class3-grade2" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`为班级「${selectedClass?.name}」添加教师`} open={addTeacherModalVisible} onOk={handleAddTeacher} onCancel={() => setAddTeacherModalVisible(false)}>
        <Form form={addTeacherForm} layout="vertical" initialValues={{ role: 'teacher' }}>
          <Form.Item name="teacher_id" label="选择教师" rules={[{ required: true, message: '请选择教师' }]}>
            <Select placeholder="选择要添加的教师" filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}>
              {teachers
                .filter(t => !selectedClass?.teachers?.some((ct: any) => ct.teacher_id === t.id))
                .map(t => <Select.Option key={t.id} value={t.id} label={t.real_name || t.username}>{t.real_name || t.username}</Select.Option>)
              }
            </Select>
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select>
              <Select.Option value="head_teacher">班主任</Select.Option>
              <Select.Option value="teacher">任课教师</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export { ClassManagement };
export default ClassManagement;
