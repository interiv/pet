import React, { useEffect, useState } from 'react';
import { Card, Button, Form, Input, message, Select, InputNumber, Row, Col, Switch, Alert } from 'antd';
import { GlobalOutlined, SafetyOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { adminAPI } from '../../utils/api';
import { FEATURE_FLAGS, FLAG_GROUPS } from '../../utils/featureFlags';

const SiteSettings: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await adminAPI.getSiteSettings();
      const data = res.data.settings || {};
      // 开关后端已保证每个 key 都有值（缺失时补默认），这里再兜一层，避免异常数据导致界面误显示为「关闭」
      const flagOn = (k: string) => data[k] !== 'false';
      form.setFieldsValue({
        site_name: data.site_name || '班级宠物养成系统',
        site_description: data.site_description || '寓教于乐，让学习更有趣',
        site_logo: data.site_logo || '🐾',
        site_footer: data.site_footer || '© 2026 班级宠物养成系统',
        site_announcement: data.site_announcement || '',
        home_notice: data.home_notice || '',
        registration_enabled: flagOn('registration_enabled'),
        class_public_enabled: flagOn('class_public_enabled'),
        ai_enabled: flagOn('ai_enabled'),
        ai_paper_judge_enabled: flagOn('ai_paper_judge_enabled'),
        paper_upload_enabled: flagOn('paper_upload_enabled'),
        battle_enabled: flagOn('battle_enabled'),
        boss_battle_enabled: flagOn('boss_battle_enabled'),
        shop_enabled: flagOn('shop_enabled'),
        equipment_shop_enabled: flagOn('equipment_shop_enabled'),
        max_pets_per_user: parseInt(data.max_pets_per_user) || 1,
        daily_login_gold: parseInt(data.daily_login_gold) || 5,
        battle_stamina_cost: parseInt(data.battle_stamina_cost) || 20,
        perm_battle_records: data.perm_battle_records || 'head_teacher',
        perm_homework_records: data.perm_homework_records || 'subject_teacher',
        perm_purchase_records: data.perm_purchase_records || 'head_teacher',
      });
    } catch (error) {
      message.error('加载网站设置失败');
    }
  };

  const handleSave = async (values: any) => {
    setLoading(true);
    try {
      // 开关统一序列化成 'true' / 'false' 字符串，与 settings 表存储格式一致
      const data: any = { ...values };
      for (const f of FEATURE_FLAGS) data[f.key] = String(!!values[f.key]);
      await adminAPI.saveSiteSettings(data);
      message.success('网站设置已保存');
      loadSettings();
    } catch (error) {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <Alert
        message="网站设置"
        description="功能开关会同时作用于前端界面与后端接口：关闭后，对应的菜单/页签不再显示，直接调用接口也会被拒绝。修改后需要刷新浏览器页面，已登录用户需重新登录以加载新的菜单。"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Card title={<span><GlobalOutlined /> 基本设置</span>} style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="site_name" label="站点名称" rules={[{ required: true, message: '请输入站点名称' }]}>
                <Input placeholder="班级宠物养成系统" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="site_logo" label="站点Logo（Emoji）" rules={[{ required: true, message: '请输入Logo' }]}>
                <Input placeholder="🐾" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="site_description" label="站点描述">
            <Input placeholder="寓教于乐，让学习更有趣" />
          </Form.Item>
          <Form.Item name="site_footer" label="底部版权信息">
            <Input placeholder="© 2026 班级宠物养成系统" />
          </Form.Item>
          <Form.Item name="site_announcement" label="全局公告">
            <Input.TextArea rows={2} placeholder="输入公告内容，留空则不显示公告栏" />
          </Form.Item>
          <Form.Item name="home_notice" label="首页公告" extra="显示在首页的浮动提示，留空则不显示。可用于展示演示账号等信息">
            <Input.TextArea rows={3} placeholder="例如：想体验系统？登录后到管理后台「系统数据」导入演示数据，演示账号 demo_teacher1 / demo_student1，密码 111111" />
          </Form.Item>
        </Card>

        {/* 功能开关：按「注册与访问 / AI 能力 / 游戏化玩法」三组展示，每项写明关掉后的实际影响 */}
        {FLAG_GROUPS.map((group) => (
          <Card
            key={group.title}
            title={<span><SafetyOutlined /> {group.title}</span>}
            extra={<span style={{ color: '#999', fontSize: 12 }}>{group.tip}</span>}
            style={{ marginBottom: 16 }}
          >
            <Row gutter={16}>
              {group.flags.map((f) => (
                <Col xs={24} md={12} key={f.key}>
                  <Form.Item
                    name={f.key}
                    label={f.label}
                    valuePropName="checked"
                    extra={f.hint}
                    tooltip={f.hint}
                  >
                    <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>
                </Col>
              ))}
            </Row>
          </Card>
        ))}

        <Card title={<span><ThunderboltOutlined /> 游戏参数</span>} style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="max_pets_per_user" label="每用户最大宠物数">
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="daily_login_gold" label="每日登录金币奖励">
                <InputNumber min={0} max={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="battle_stamina_cost" label="战斗体力消耗">
                <InputNumber min={0} max={200} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title={<span><SafetyOutlined /> 数据查看权限</span>} style={{ marginBottom: 16 }}>
          <Alert
            message="权限说明"
            description={
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li><b>仅班主任</b>：只有班主任可以查看</li>
                <li><b>任课教师</b>：任课教师可以查看自己任教班级的数据，班主任可查看所有</li>
                <li><b>所有教师</b>：所有教师均可查看任教班级的数据</li>
              </ul>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="perm_battle_records" label="战斗记录查看权限">
                <Select>
                  <Select.Option value="head_teacher">仅班主任</Select.Option>
                  <Select.Option value="subject_teacher">任课教师</Select.Option>
                  <Select.Option value="all_teacher">所有教师</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="perm_homework_records" label="作业记录查看权限">
                <Select>
                  <Select.Option value="head_teacher">仅班主任</Select.Option>
                  <Select.Option value="subject_teacher">任课教师</Select.Option>
                  <Select.Option value="all_teacher">所有教师</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="perm_purchase_records" label="购买记录查看权限">
                <Select>
                  <Select.Option value="head_teacher">仅班主任</Select.Option>
                  <Select.Option value="subject_teacher">任课教师</Select.Option>
                  <Select.Option value="all_teacher">所有教师</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} size="large">
            保存所有设置
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

export { SiteSettings };
export default SiteSettings;
