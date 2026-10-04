import React, { useEffect, useState } from 'react';
import { Table, Button, Form, Input, message, Tag, Space, Modal, Select, Popconfirm, Alert, Divider, AutoComplete } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { adminAPI, schoolAPI } from '../../utils/api';
import { useTablePagination } from './hooks';
import { SUBJECT_OPTIONS } from '../../utils/subjects';

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
  // 新建：一行一条任教关系（班级 + 身份 + 科目）
  const createAssignments: any[] = Form.useWatch('assignments', createForm) || [];
  // 选学校后只显示该校班级（未分配学校的历史班级始终保留）
  const createClassOptions = createSchoolId
    ? classList.filter((c: any) => c.school_id === createSchoolId || !c.school_id)
    : classList;
  // 班主任只能分配到"还没有班主任"的班级
  const headTeacherCandidateClasses = createClassOptions.filter(
    (c: any) => !c.head_teacher_id && !(c.teachers || []).some((t: any) => t.role === 'head_teacher')
  );

  // 编辑弹窗：任教关系按「一行一条」编辑，班级下拉需排除其它教师已占的班主任位
  const editAssignments: any[] = Form.useWatch('assignments', form) || [];
  const classOptionsForEdit = (role: string, excludeClassIds: number[]) =>
    classList
      .filter((c: any) => !excludeClassIds.includes(c.id))
      .filter((c: any) => {
        if (role !== 'head_teacher') return true;
        const occupiedByOther = c.head_teacher_id && c.head_teacher_id !== editingTeacher?.id;
        const hasOtherHead = (c.teachers || []).some(
          (t: any) => t.role === 'head_teacher' && t.teacher_id !== editingTeacher?.id
        );
        return !occupiedByOther && !hasOtherHead;
      })
      .map((c: any) => ({ value: c.id, label: `${c.name}${c.grade ? `（${c.grade}）` : ''}` }));

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
      // 一行一条任教关系：既是班主任还是任课教师、教哪门课，都跟着这条记录走
      assignments: (record.classes || []).map((c: any) => ({
        class_id: c.id,
        role: c.role === 'head_teacher' ? 'head_teacher' : 'teacher',
        subject: c.subject || undefined,
      })),
    });
    setEditModalVisible(true);
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const payload = {
        ...values,
        // 一行一条：班级 + 身份 + 科目；后端整份覆盖写入
        assignments: (values.assignments || [])
          .filter((r: any) => r && r.class_id)
          .map((r: any) => ({
            class_id: Number(r.class_id),
            role: r.role === 'head_teacher' ? 'head_teacher' : 'teacher',
            subject: (r.subject || '').trim() || undefined,
          })),
      };
      const res = await adminAPI.createTeacher(payload);
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
        // 任教关系：整份列表覆盖提交（含空数组 = 移出所有班级）
        assignments: (values.assignments || []).map((row: any) => ({
          class_id: row.class_id,
          role: row.role === 'head_teacher' ? 'head_teacher' : 'teacher',
          subject: (row.subject || '').trim() || undefined,
        })),
      };
      const res = await adminAPI.updateTeacher(editingTeacher.id, payload);
      message.success(res.data?.message || '教师信息更新成功');
      setEditModalVisible(false);
      form.resetFields();
      loadTeachers();
    } catch (error: any) {
      if (error?.errorFields) {
        message.warning(error.errorFields[0]?.errors?.[0]?.message || '请检查表单填写');
      } else if (error?.response?.data?.error) {
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
      title: '任教班级 / 身份',
      key: 'classes',
      render: (_: any, record: any) => {
        const classes: any[] = record.classes || [];
        if (classes.length === 0) {
          return <span style={{ color: '#bbb' }}>未分配班级</span>;
        }
        // 一个班级一个块，身份跟着班级走：「演示1班（班主任）」「演示2班（任课教师）」
        return (
          <Space size={[4, 4]} wrap>
            {classes.map((c) => (
              <Tag key={c.id} color={c.role === 'head_teacher' ? 'gold' : 'default'}>
                {c.name}
                <span style={{ opacity: 0.7, fontSize: 12 }}>
                  （{c.role === 'head_teacher' ? '班主任' : '任课教师'}{c.subject ? ` · ${c.subject}` : ''}）
                </span>
              </Tag>
            ))}
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
              onChange={() => {
                const rows = createForm.getFieldValue('assignments') || [];
                createForm.setFieldsValue({
                  class_id: undefined,
                  class_ids: undefined,
                  assignments: rows.map((r: any) => ({ ...r, class_id: undefined })),
                });
              }}
              options={schools.map((s: any) => ({ value: s.id, label: `${s.name}${s.city ? ` - ${s.city}` : ''}` }))}
            />
          </Form.Item>
          <Divider style={{ margin: '4px 0 12px' }} orientation="left" plain>任教关系（一个班级一条）</Divider>
          <Form.List name="assignments">
            {(fields, { add, remove }) => (
              <>
                {fields.length === 0 && (
                  <div style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>
                    暂不分配班级也可以先创建教师，之后随时在这里补。
                  </div>
                )}
                {fields.map((field) => {
                  const rowRole = createAssignments[field.name]?.role || 'teacher';
                  const usedByOthers = createAssignments
                    .filter((_: any, i: number) => i !== field.name)
                    .map((r: any) => r?.class_id)
                    .filter(Boolean);
                  const options = (rowRole === 'head_teacher' ? headTeacherCandidateClasses : createClassOptions)
                    .filter((c: any) => !usedByOthers.includes(c.id));
                  return (
                    <Space key={field.key} align="center" wrap style={{ display: 'flex', marginBottom: 8 }}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'class_id']}
                        rules={[{ required: true, message: '请选择班级' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="选择班级"
                          style={{ width: 220 }}
                          options={options.map((c: any) => ({ value: c.id, label: `${c.name}${c.grade ? `（${c.grade}）` : ''}` }))}
                        />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'role']} style={{ marginBottom: 0 }}>
                        <Select
                          style={{ width: 130 }}
                          onChange={(v) => {
                            if (v !== 'head_teacher') return;
                            const list = createForm.getFieldValue('assignments') || [];
                            const otherHead = list.some((r: any, i: number) => i !== field.name && r?.role === 'head_teacher');
                            if (otherHead) {
                              message.warning('一个教师只能担任一个班的班主任');
                              createForm.setFieldValue(['assignments', field.name, 'role'], 'teacher');
                            }
                          }}
                          options={[
                            { value: 'teacher', label: '任课教师' },
                            { value: 'head_teacher', label: '班主任' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'subject']} style={{ marginBottom: 0 }}>
                        <AutoComplete
                          style={{ width: 140 }}
                          placeholder="科目（选填）"
                          options={SUBJECT_OPTIONS.map(s => ({ value: s }))}
                          filterOption={(input, option) =>
                            String(option?.value ?? '').toLowerCase().includes(String(input).toLowerCase())
                          }
                        />
                      </Form.Item>
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                    </Space>
                  );
                })}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ class_id: undefined, role: 'teacher' })}>
                  添加一条任教关系
                </Button>
                <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
                  一个班级只能有一位班主任；班主任下拉只显示还没被占用的班级。科目用于布置作业时自动带出。
                </div>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* 任教关系一行要放下「班级 + 身份 + 科目 + 删除」四块，默认 520px 会挤成一团，故加宽 */}
      <Modal
        title="编辑教师"
        open={editModalVisible}
        onOk={handleUpdate}
        onCancel={() => { setEditModalVisible(false); form.resetFields(); }}
        width={760}
      >
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

          <Divider style={{ margin: '4px 0 12px' }} orientation="left" plain>任教关系（一个班级一条）</Divider>
          <Form.List name="assignments">
            {(fields, { add, remove }) => (
              <>
                {fields.length === 0 && (
                  <div style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>暂未分配班级，可在下方添加。</div>
                )}
                {fields.map((field) => {
                  // 注意：这里不能每行都调useWatch（行数变化会导致 hooks 数量变化），
                  // 统一从组件顶部的 editAssignments 里取
                  const rowRole = editAssignments[field.name]?.role || 'teacher';
                  // 同一班级不能重复出现在多行里
                  const usedByOthers = editAssignments
                    .filter((_: any, i: number) => i !== field.name)
                    .map((r: any) => r?.class_id)
                    .filter(Boolean);
                  return (
                    <Space key={field.key} align="center" style={{ display: 'flex', marginBottom: 8 }}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'class_id']}
                        rules={[{ required: true, message: '请选择班级' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="选择班级"
                          style={{ width: 220 }}
                          options={classOptionsForEdit(rowRole, usedByOthers)}
                        />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'role']} style={{ marginBottom: 0 }}>
                        <Select
                          style={{ width: 130 }}
                          onChange={(v) => {
                            if (v !== 'head_teacher') return;
                            // 一个教师只能当一个班的班主任
                            const list = form.getFieldValue('assignments') || [];
                            const otherHead = list.some((r: any, i: number) => i !== field.name && r?.role === 'head_teacher');
                            if (otherHead) {
                              message.warning('一个教师只能担任一个班的班主任，另一条需改为任课教师');
                              form.setFieldValue(['assignments', field.name, 'role'], 'teacher');
                            }
                          }}
                          options={[
                            { value: 'teacher', label: '任课教师' },
                            { value: 'head_teacher', label: '班主任' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, 'subject']} style={{ marginBottom: 0 }}>
                        <AutoComplete
                          style={{ width: 140 }}
                          placeholder="科目（选填）"
                          options={SUBJECT_OPTIONS.map(s => ({ value: s }))}
                          filterOption={(input, option) =>
                            String(option?.value ?? '').toLowerCase().includes(String(input).toLowerCase())
                          }
                        />
                      </Form.Item>
                      <Popconfirm title="删除这条任教关系？" onConfirm={() => remove(field.name)} okText="删除" cancelText="取消">
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  );
                })}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ class_id: undefined, role: 'teacher' })}>
                  添加一条任教关系
                </Button>
                <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
                  一个班级只能有一位班主任；这里只显示还没被其他教师占用的班主任位。
                </div>
              </>
            )}
          </Form.List>

          <Form.Item name="status" label="状态" style={{ marginTop: 16 }}>
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
