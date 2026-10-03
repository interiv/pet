import React, { useEffect, useState } from 'react';
import { Table, Button, Form, Input, message, Tag, Space, Modal, Select, Popconfirm, Alert } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminAPI, schoolAPI } from '../../utils/api';
import { useTablePagination } from './hooks';

const TeacherManagement: React.FC<{ onGoApprove?: () => void }> = ({ onGoApprove }) => {
  const pagination = useTablePagination();
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<any>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [schools, setSchools] = useState<any[]>([]);
  const [classList, setClassList] = useState<any[]>([]);
  const [form] = Form.useForm();
  const [createForm] = Form.useForm();

  useEffect(() => {
    loadTeachers();
  }, [statusFilter, searchText]);

  // 打开"添加教师 / 编辑教师"弹窗时刷新学校与班级（可能刚在其他页签新建过）
  useEffect(() => {
    if (!createModalVisible && !editModalVisible) return;
    (async () => {
      try {
        const [sRes, cRes] = await Promise.all([schoolAPI.getSchools(), adminAPI.getClasses()]);
        setSchools(sRes.data.schools || []);
        setClassList(cRes.data.classes || []);
      } catch (e) {
        console.error('加载学校/班级列表失败', e);
      }
    })();
  }, [createModalVisible, editModalVisible]);

  const createSchoolId = Form.useWatch('school_id', createForm);
  const createIdentity = Form.useWatch('teacher_identity', createForm) || 'teacher';
  // 选学校后只显示该校班级（未分配学校的历史班级始终保留）
  const createClassOptions = createSchoolId
    ? classList.filter((c: any) => c.school_id === createSchoolId || !c.school_id)
    : classList;
  // 班主任只能分配到"还没有班主任"的班级
  const headTeacherCandidateClasses = createClassOptions.filter(
    (c: any) => !c.head_teacher_id && !(c.teachers || []).some((t: any) => t.role === 'head_teacher')
  );

  const editSchoolId = Form.useWatch('school_id', form);
  const editIdentity = Form.useWatch('teacher_identity', form) || 'teacher';
  const editClassOptions = editSchoolId
    ? classList.filter((c: any) => c.school_id === editSchoolId || !c.school_id)
    : classList;
  // 编辑时把自己当前担任班主任的班级也算作候选，否则无法「保持原样」
  const editHeadTeacherCandidateClasses = editClassOptions.filter(
    (c: any) =>
      (!c.head_teacher_id && !(c.teachers || []).some((t: any) => t.role === 'head_teacher'))
      || c.head_teacher_id === editingTeacher?.id
  );

  const loadTeachers = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getTeachers({ status: statusFilter || undefined, search: searchText || undefined });
      setTeachers(res.data.teachers || []);
    } catch (error) {
      message.error('加载教师列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (record: any) => {
    setEditingTeacher(record);
    form.setFieldsValue({
      real_name: record.real_name || '',
      username: record.username,
      email: record.email || '',
      status: record.status,
      password: '',
      teacher_identity: record.teacher_identity === 'head_teacher' ? 'head_teacher' : 'teacher',
      class_ids: (record.classes || []).filter((c: any) => c.role !== 'head_teacher').map((c: any) => c.id),
      class_id: (record.classes || []).find((c: any) => c.role === 'head_teacher')?.id,
    });
    setEditModalVisible(true);
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const res = await adminAPI.createTeacher(values);
      message.success(res.data?.message || '教师创建成功，可直接登录使用');
      setCreateModalVisible(false);
      createForm.resetFields();
      loadTeachers();
    } catch (error: any) {
      if (error?.response?.data?.error) {
        message.error(error.response.data.error);
      }
    }
  };

  const handleUpdate = async () => {
    try {
      const values = await form.validateFields();
      const payload: any = {
        real_name: values.real_name,
        username: values.username,
        email: values.email,
        status: values.status,
        // 留空表示不修改密码
        password: values.password || undefined,
      };
      // 班级归属：班主任只能一个班（单选），任课教师可多班（多选）
      if (values.teacher_identity === 'head_teacher') {
        payload.teacher_identity = 'head_teacher';
        payload.class_id = values.class_id ?? null;
        payload.class_ids = [];
      } else {
        payload.teacher_identity = 'teacher';
        payload.class_ids = values.class_ids || [];
      }
      const res = await adminAPI.updateTeacher(editingTeacher.id, payload);
      message.success(res.data?.message || '教师信息更新成功');
      setEditModalVisible(false);
      form.resetFields();
      loadTeachers();
    } catch (error: any) {
      if (error?.response?.data?.error) {
        message.error(error.response.data.error);
      } else {
        message.error('更新失败');
      }
    }
  };

  const handleDelete = async (id: number, action: 'delete' | 'disable') => {
    try {
      await adminAPI.deleteTeacher(id, action);
      message.success(action === 'delete' ? '教师已删除' : '教师已禁用');
      loadTeachers();
    } catch (error) {
      message.error('操作失败');
    }
  };

  // 待审批的教师数量（审批动作统一放在「申请审批 → 教师申请」页签，避免两处重复）
  const pendingTeacherCount = teachers.filter((t: any) => t.status === 'pending_approval').length;

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '姓名', dataIndex: 'real_name', key: 'real_name', render: (v: string) => v || <span style={{ color: '#bbb' }}>—</span> },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    {
      title: '身份 / 班级',
      key: 'classes',
      render: (_: any, record: any) => {
        const classes: any[] = record.classes || [];
        if (classes.length === 0) {
          return <span style={{ color: '#bbb' }}>未分配班级</span>;
        }
        return (
          <Space direction="vertical" size={2}>
            <Tag color={record.teacher_identity === 'head_teacher' ? 'gold' : 'blue'}>
              {record.teacher_identity === 'head_teacher' ? '班主任' : '任课教师'}
            </Tag>
            <Space size={4} wrap>
              {classes.map((c) => (
                <Tag key={c.id} color={c.role === 'head_teacher' ? 'gold' : 'default'}>
                  {c.name}{c.role === 'head_teacher' ? '（班主任）' : ''}
                </Tag>
              ))}
            </Space>
          </Space>
        );
      }
    },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleDateString() },
    { title: '最后登录', dataIndex: 'last_login', key: 'last_login', render: (v: string) => v ? new Date(v).toLocaleDateString() : '从未登录' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const map: any = { active: { color: 'green', text: '已激活' }, pending_approval: { color: 'warning', text: '待审批' }, disabled: { color: 'red', text: '已禁用' } };
        const s = map[status] || { color: 'default', text: status };
        return <Tag color={s.color}>{s.text}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        record.status === 'pending_approval' ? (
          <Space>
            {onGoApprove && <Button type="link" onClick={onGoApprove}>去审批</Button>}
            <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
            <Popconfirm title="确定删除该教师？" onConfirm={() => handleDelete(record.id, 'delete')}>
              <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        ) : (
          <Space>
            <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
            {record.status !== 'disabled' && (
              <Button type="link" danger onClick={() => handleDelete(record.id, 'disable')}>禁用</Button>
            )}
            <Popconfirm title="确定删除该教师？" onConfirm={() => handleDelete(record.id, 'delete')}>
              <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        )
      ),
    },
  ];

  return (
    <div>
      {pendingTeacherCount > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`有 ${pendingTeacherCount} 个教师账号待审批`}
          description={
            <span>
              教师注册申请统一在「申请审批 → 教师申请」中处理，批准后会自动成为班主任或以任课教师身份加入所选班级。
              {onGoApprove && (
                <Button type="link" size="small" style={{ paddingLeft: 4 }} onClick={onGoApprove}>立即去审批</Button>
              )}
            </span>
          }
        />
      )}
      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search placeholder="搜索教师" onSearch={setSearchText} style={{ width: 200 }} allowClear />
          <Select placeholder="筛选状态" style={{ width: 120 }} allowClear value={statusFilter || undefined} onChange={setStatusFilter}>
            <Select.Option value="active">已激活</Select.Option>
            <Select.Option value="pending_approval">待审批</Select.Option>
            <Select.Option value="disabled">已禁用</Select.Option>
          </Select>
          <Button onClick={loadTeachers}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>添加教师</Button>
        </Space>
      </div>
      <Table columns={columns} dataSource={teachers} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal
        title="添加教师"
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => { setCreateModalVisible(false); createForm.resetFields(); }}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="real_name"
            label="姓名"
            rules={[{ required: true, message: '请输入教师姓名' }, { max: 20, message: '姓名最多 20 个字符' }]}
          >
            <Input placeholder="教师姓名" />
          </Form.Item>
          <Form.Item
            name="username"
            label="用户名（登录账号）"
            tooltip="用于登录的账号，可以和姓名不一样"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, message: '用户名至少 3 个字符' }
            ]}
          >
            <Input placeholder="教师登录用的用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: '请输入初始密码' },
              { min: 6, message: '密码至少 6 个字符' }
            ]}
          >
            <Input.Password placeholder="至少 6 个字符，教师首次登录后可自行修改" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱（可选）"
            rules={[{ type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="school_id" label="所属学校（用于筛选班级）">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择学校（可选）"
              onChange={() => createForm.setFieldsValue({ class_id: undefined, class_ids: undefined })}
              options={schools.map((s: any) => ({ value: s.id, label: `${s.name}${s.city ? ` - ${s.city}` : ''}` }))}
            />
          </Form.Item>
          <Form.Item
            name="teacher_identity"
            label="教师身份"
            initialValue="teacher"
            tooltip="选择班级后生效：班主任会成为该班班主任（一名教师只能带一个班），任课教师可同时加入多个班级"
          >
            <Select
              onChange={() => {
                // 切换身份时清空已选班级（两种身份用的字段不同）
                createForm.setFieldsValue({ class_id: undefined, class_ids: undefined });
              }}
            >
              <Select.Option value="teacher">任课教师</Select.Option>
              <Select.Option value="head_teacher">班主任</Select.Option>
            </Select>
          </Form.Item>

          {createIdentity === 'head_teacher' ? (
            <Form.Item name="class_id" label="分配班级（可选，只能选一个）">
              <Select
                allowClear
                showSearch
                optionFilterProp="children"
                placeholder={headTeacherCandidateClasses.length ? '选择班级' : '暂无可选班级（都已设置班主任）'}
              >
                {headTeacherCandidateClasses.map((c: any) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}{c.grade ? `（${c.grade}）` : ''}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : (
            <Form.Item name="class_ids" label="分配班级（可多选，也可以先不选）">
              <Select
                mode="multiple"
                allowClear
                showSearch
                optionFilterProp="children"
                maxTagCount={3}
                placeholder={createClassOptions.length ? '选择班级（可多选）' : '暂无可选班级'}
              >
                {createClassOptions.map((c: any) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}{c.grade ? `（${c.grade}）` : ''}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal title="编辑教师" open={editModalVisible} onOk={handleUpdate} onCancel={() => { setEditModalVisible(false); form.resetFields(); }}>
        <Form form={form} layout="vertical">
          <Form.Item name="real_name" label="姓名"><Input placeholder="教师姓名" /></Form.Item>
          <Form.Item name="username" label="用户名（登录账号）"><Input /></Form.Item>
          <Form.Item
            name="password"
            label="重置密码"
            extra="留空表示不修改；填写并保存后立即生效，教师下次登录请使用新密码"
            rules={[{ validator: (_, v) => (!v || String(v).length >= 6) ? Promise.resolve() : Promise.reject(new Error('密码至少 6 位')) }]}
          >
            <Input.Password
              placeholder="至少 6 位，留空不修改"
              autoComplete="new-password"
              addonAfter={<a onClick={() => form.setFieldValue('password', String(Math.floor(100000 + Math.random() * 900000)))}>随机生成</a>}
            />
          </Form.Item>
          <Form.Item name="email" label="邮箱"><Input /></Form.Item>
          <Form.Item name="school_id" label="所属学校（用于筛选班级）" tooltip="仅用于筛选下方班级列表，不会写入教师资料">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择学校（可选）"
              onChange={() => form.setFieldsValue({ class_id: undefined, class_ids: undefined })}
              options={schools.map((s: any) => ({ value: s.id, label: `${s.name}${s.city ? ` - ${s.city}` : ''}` }))}
            />
          </Form.Item>
          <Form.Item
            name="teacher_identity"
            label="教师身份"
            tooltip="班主任只能带一个班；任课教师可以同时加入多个班级。修改后下方班级列表按此身份保存"
          >
            <Select
              onChange={() => {
                // 切换身份时清空已选班级（两种身份用的字段不同）
                form.setFieldsValue({ class_id: undefined, class_ids: undefined });
              }}
            >
              <Select.Option value="teacher">任课教师</Select.Option>
              <Select.Option value="head_teacher">班主任</Select.Option>
            </Select>
          </Form.Item>

          {editIdentity === 'head_teacher' ? (
            <Form.Item name="class_id" label="担任班主任的班级（只能一个）">
              <Select
                allowClear
                showSearch
                optionFilterProp="children"
                placeholder={editHeadTeacherCandidateClasses.length ? '选择班级' : '暂无可选班级（都已设置班主任）'}
              >
                {editHeadTeacherCandidateClasses.map((c: any) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}{c.grade ? `（${c.grade}）` : ''}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : (
            <Form.Item name="class_ids" label="任教班级（可多选，留空表示暂不分配班级）">
              <Select
                mode="multiple"
                allowClear
                showSearch
                optionFilterProp="children"
                maxTagCount={3}
                placeholder={editClassOptions.length ? '选择班级（可多选）' : '暂无可选班级'}
              >
                {editClassOptions.map((c: any) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}{c.grade ? `（${c.grade}）` : ''}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
          <Form.Item name="status" label="状态">
            <Select>
              <Select.Option value="active">已激活</Select.Option>
              <Select.Option value="pending_approval">待审批</Select.Option>
              <Select.Option value="disabled">已禁用</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export { TeacherManagement };
export default TeacherManagement;
