import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Card, message, Typography, Select, Alert, AutoComplete, Divider, Space } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, LinkOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { authAPI, classAPI, schoolAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { SUBJECT_OPTIONS } from '../utils/subjects';

const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
};

const { Title } = Typography;
const { Option } = Select;

const Register: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const login = useAuthStore((state) => state.login);
  const [loading, setLoading] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(null);
  const [selectedRole, setSelectedRole] = useState('student');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteInfo, setInviteInfo] = useState<any>(null);
  const isMobile = useMobile();
  const [form] = Form.useForm();
  // 教师注册：一行一条任教关系（班级 + 身份 + 科目）
  const teacherRows: any[] = Form.useWatch('assignments', form) || [];

  useEffect(() => {
    loadClasses();
    loadSchools();
    // 从 URL 参数中获取邀请码
    const code = searchParams.get('invite');
    if (code) {
      setInviteCode(code);
      validateInviteCode(code);
    }
  }, [searchParams]);

  const loadClasses = async () => {
    try {
      const res = await classAPI.getPublicClasses();
      setClasses(res.data.classes || []);
    } catch (error) {
      console.error('加载班级列表失败:', error);
    }
  };

  const loadSchools = async () => {
    try {
      const res = await schoolAPI.getSchools();
      setSchools(res.data.schools || []);
    } catch (error) {
      console.error('加载学校列表失败:', error);
    }
  };

  // 按学校筛选班级；未分配学校的历史班级始终保留显示，避免选校后"消失"
  const filteredClasses = selectedSchoolId
    ? classes.filter((c: any) => c.school_id === selectedSchoolId || !c.school_id)
    : classes;

  // 申请班主任时，只显示还没有班主任的班级（前端直接不展示，服务端仍会二次校验）
  const headTeacherCandidates = filteredClasses.filter((c: any) => !c.has_head_teacher);

  const validateInviteCode = async (code: string) => {
    if (!code) return;
    try {
      const res = await classAPI.validateInvitation(code);
      setInviteInfo(res.data);
      // 如果邀请码限制了角色，自动选择对应角色
      if (res.data.role_filter !== 'any') {
        setSelectedRole(res.data.role_filter);
      }
      message.success('邀请码验证成功');
    } catch (error: any) {
      message.error(error.response?.data?.error || '邀请码无效');
      setInviteInfo(null);
    }
  };

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const { confirmPassword, role, assignments, ...registerData } = values;

      // 教师：把「一行一条」的任教关系整理成后端需要的结构（同时保留旧字段，兼容旧后端）
      const teachingRows = (assignments || [])
        .filter((r: any) => r && r.class_id)
        .map((r: any) => ({
          class_id: Number(r.class_id),
          role: r.role === 'head_teacher' ? 'head_teacher' : 'teacher',
          subject: (r.subject || '').trim() || undefined,
        }));
      const teacherType = teachingRows.some((r: any) => r.role === 'head_teacher') ? 'head_teacher' : 'teacher';

      // 如果有邀请码，使用邀请注册 API
      if (inviteCode && inviteInfo) {
        const response = await classAPI.registerWithInvite({
          ...registerData,
          role: role || 'student',
          invitation_code: inviteCode
        });
        
        login(response.data.token, response.data.user);
        message.success('注册成功并已加入班级！');
        navigate('/');
      } else {
        // 普通注册：学生 / 教师（均需选择班级，等待审批）
        const response = await authAPI.register({
          ...registerData,
          role,
          // 一行一条：班级 + 身份（班主任/任课教师）+ 科目
          assignments: teachingRows,
          // 兼容旧参数：班主任单选、任课教师多选
          teacher_type: teacherType,
          requested_class_ids: teachingRows.map((r: any) => r.class_id),
          requested_class_id: teachingRows.length === 1 ? teachingRows[0].class_id : undefined,
        });
        if (response.data.pending) {
          message.success(response.data.message);
          navigate('/login');
        } else {
          login(response.data.token, response.data.user);
          message.success('注册成功！');
          navigate('/');
        }
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}>
      <Card style={{ width: isMobile ? '92vw' : 450, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <Title level={2} style={{ color: '#667eea', marginBottom: 8 }}>
            🎉 注册新账号
          </Title>
          <p style={{ color: '#999' }}>加入班级宠物养成系统</p>
        </div>

        <Form
          form={form}
          name="register"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="real_name"
            label="姓名"
            rules={[
              { required: true, message: '请输入姓名!' },
              { max: 20, message: '姓名最多 20 个字符!' }
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="真实姓名（老师/同学怎么称呼你）"
            />
          </Form.Item>

          <Form.Item
            name="username"
            label="用户名（登录账号）"
            tooltip="用于登录的账号，可以和姓名不一样"
            rules={[
              { required: true, message: '请输入用户名!' },
              { min: 3, message: '用户名至少 3 个字符!' }
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="用户名（登录账号）"
            />
          </Form.Item>

          <Form.Item
            name="email"
            label="邮箱（选填）"
            rules={[
              { type: 'email', message: '请输入有效的邮箱地址!' }
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="邮箱（选填）"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码!' },
              { min: 6, message: '密码至少 6 个字符!' }
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码!' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致!'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="确认密码"
            />
          </Form.Item>

          <Form.Item
            name="role"
            label="注册身份"
            initialValue="student"
            rules={[{ required: true, message: '请选择注册身份' }]}
          >
            <Select placeholder="选择角色" onChange={(value) => setSelectedRole(value)} disabled={!!inviteInfo && inviteInfo.role_filter !== 'any'}>
              <Option value="student">学生</Option>
              <Option value="teacher">教师</Option>
            </Select>
          </Form.Item>

          {/* 推荐码信息展示 */}
          {inviteInfo && (
            <Alert
              message="通过班级推荐码注册"
              description={
                <div>
                  <p><strong>班级：</strong>{inviteInfo.class_name} {inviteInfo.grade ? `(${inviteInfo.grade})` : ''}</p>
                  <p><strong>班主任：</strong>{inviteInfo.creator_name}</p>
                  {inviteInfo.role_filter !== 'any' && (
                    <p><strong>适用对象：</strong>{inviteInfo.role_filter === 'student' ? '学生' : '教师'}</p>
                  )}
                  <p style={{ marginTop: 8, color: '#52c41a' }}>✓ 注册后将自动加入该班级，无需审批</p>
                </div>
              }
              type="success"
              style={{ marginBottom: 16 }}
              icon={<LinkOutlined />}
            />
          )}

          {/* 班级推荐码手动输入暂时隐藏：注册改为直接选择学校和班级 */}

          {!inviteInfo && (
            <Form.Item
              name="school_id"
              label="选择所在学校"
              tooltip="选择学校后，下方只会显示该学校的班级"
              rules={[{ required: true, message: '请选择所在学校' }]}
            >
              <Select
                showSearch
                placeholder="请选择所在学校"
                optionFilterProp="label"
                onChange={(v: number) => {
                  setSelectedSchoolId(v);
                  // 学校变化后清空已选班级，避免选到别校的班级
                  const rows = form.getFieldValue('assignments') || [];
                  form.setFieldsValue({
                    requested_class_id: undefined,
                    requested_class_ids: undefined,
                    assignments: rows.map((r: any) => ({ ...r, class_id: undefined })),
                  });
                }}
                options={schools.map((s: any) => ({ value: s.id, label: `${s.name}${s.city ? ` - ${s.city}` : ''}` }))}
              />
            </Form.Item>
          )}

          {!inviteInfo && selectedRole === 'student' && (
            <Form.Item
              name="requested_class_id"
              label="选择要加入的班级"
              rules={[{ required: true, message: '请选择要加入的班级' }]}
            >
              <Select placeholder={filteredClasses.length ? '选择班级' : '当前学校暂无公开班级，请使用老师给的邀请码'} showSearch optionFilterProp="children">
                {filteredClasses.map(c => (
                  <Option key={c.id} value={c.id}>{c.name} {c.grade ? `(${c.grade})` : ''}{c.school_name ? ` · ${c.school_name}` : ''}</Option>
                ))}
              </Select>
            </Form.Item>
          )}

          {!inviteInfo && selectedRole === 'teacher' && (
            <>
              <Divider style={{ margin: '4px 0 12px' }} orientation="left" plain>
                任教班级与身份（一个班级一条）
              </Divider>
              <Form.List
                name="assignments"
                rules={[
                  {
                    validator: async (_: any, rows: any[]) => {
                      if (!rows || rows.length === 0) {
                        return Promise.reject(new Error('请至少添加一条任教班级'));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                {(fields, { add, remove }) => (
                  <>
                    {fields.length === 0 && (
                      <div style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>
                        还没有添加任教班级，可先选学校再添加。
                      </div>
                    )}
                    {fields.map((field) => {
                      const rowRole = teacherRows[field.name]?.role || 'teacher';
                      const usedByOthers = teacherRows
                        .filter((_: any, i: number) => i !== field.name)
                        .map((r: any) => r?.class_id)
                        .filter(Boolean);
                      // 班主任行只能选还没有班主任的班级
                      const candidates = (rowRole === 'head_teacher' ? headTeacherCandidates : filteredClasses)
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
                              optionFilterProp="children"
                              placeholder="选择班级"
                              style={{ minWidth: 200 }}
                            >
                              {candidates.map(c => (
                                <Option key={c.id} value={c.id}>
                                  {c.name} {c.grade ? `(${c.grade})` : ''}{c.school_name ? ` · ${c.school_name}` : ''}
                                </Option>
                              ))}
                            </Select>
                          </Form.Item>
                          <Form.Item {...field} name={[field.name, 'role']} style={{ marginBottom: 0 }}>
                            <Select
                              style={{ width: 130 }}
                              onChange={(v) => {
                                if (v !== 'head_teacher') return;
                                const list = form.getFieldValue('assignments') || [];
                                const otherHead = list.some((r: any, i: number) => i !== field.name && r?.role === 'head_teacher');
                                if (otherHead) {
                                  message.warning('一个教师只能担任一个班的班主任');
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
                              style={{ width: 120 }}
                              placeholder="科目（选填）"
                              options={SUBJECT_OPTIONS.map(s => ({ value: s }))}
                              filterOption={(input, option) =>
                                String(option?.value ?? '').toLowerCase().includes(String(input).toLowerCase())
                              }
                            />
                          </Form.Item>
                          <Button
                            type="text"
                            danger
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => remove(field.name)}
                          />
                        </Space>
                      );
                    })}
                    <Button
                      type="dashed"
                      block
                      icon={<PlusOutlined />}
                      onClick={() => add({ class_id: undefined, role: 'teacher', subject: undefined })}
                    >
                      添加一条任教班级
                    </Button>
                    <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
                      一个班级一条：可以同时在多个班任课；班主任只能有一个班。科目用于布置作业时自动带出，可随时修改。
                    </div>
                  </>
                )}
              </Form.List>
            </>
          )}

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
              style={{ marginTop: 8 }}
            >
              注册
            </Button>
          </Form.Item>

          <div style={{ textAlign: 'center' }}>
            <Link to="/login">已有账号？立即登录</Link>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default Register;
