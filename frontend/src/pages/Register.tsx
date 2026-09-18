import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Card, message, Typography, Select, Alert } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, LinkOutlined } from '@ant-design/icons';
import { authAPI, classAPI, schoolAPI } from '../utils/api';
import { useAuthStore } from '../store/authStore';

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
  const [teacherType, setTeacherType] = useState<'head_teacher' | 'teacher'>('head_teacher');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteInfo, setInviteInfo] = useState<any>(null);
  const isMobile = useMobile();
  const [form] = Form.useForm();

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
      const { confirmPassword, role, ...registerData } = values;
      
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
          requested_class_ids: values.requested_class_ids
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
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名!' },
              { min: 3, message: '用户名至少 3 个字符!' }
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="用户名"
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
                  form.setFieldsValue({ requested_class_id: undefined, requested_class_ids: undefined });
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
              <Form.Item
                name="teacher_type"
                label="教师类型"
                initialValue="head_teacher"
                rules={[{ required: true, message: '请选择教师类型' }]}
              >
                <Select
                  onChange={(value) => {
                    setTeacherType(value);
                    // 切换身份后清空已选班级（两种身份用的字段不同）
                    form.setFieldsValue({ requested_class_id: undefined, requested_class_ids: undefined });
                  }}
                >
                  <Option value="head_teacher">班主任（只能选择一个班级）</Option>
                  <Option value="teacher">任课教师（可同时申请多个班级）</Option>
                </Select>
              </Form.Item>

              {teacherType === 'head_teacher' ? (
                <Form.Item
                  name="requested_class_id"
                  label="选择要担任班主任的班级"
                  rules={[{ required: true, message: '请选择要担任班主任的班级' }]}
                >
                  <Select
                    placeholder={
                      headTeacherCandidates.length
                        ? '选择班级'
                        : '当前暂无缺少班主任的班级，请联系管理员'
                    }
                    showSearch
                    optionFilterProp="children"
                  >
                    {headTeacherCandidates.map(c => (
                      <Option key={c.id} value={c.id}>
                        {c.name} {c.grade ? `(${c.grade})` : ''}{c.school_name ? ` · ${c.school_name}` : ''}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              ) : (
                <Form.Item
                  name="requested_class_ids"
                  label="选择要加入的班级（可多选）"
                  rules={[{ required: true, message: '请至少选择一个班级' }]}
                >
                  <Select
                    mode="multiple"
                    placeholder={filteredClasses.length ? '选择要加入的班级' : '当前学校暂无公开班级'}
                    maxTagCount={2}
                    showSearch
                    optionFilterProp="children"
                  >
                    {filteredClasses.map(c => (
                      <Option key={c.id} value={c.id}>
                        {c.name} {c.grade ? `(${c.grade})` : ''}{c.school_name ? ` · ${c.school_name}` : ''}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              )}
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
