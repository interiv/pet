import React, { useState } from 'react';
import { Typography, Form, Input, Button, message, Card, Row, Col, Space } from 'antd';
import { MailOutlined, MessageOutlined, GithubOutlined } from '@ant-design/icons';
import StaticPageLayout from '../components/StaticPageLayout';

const { Title, Paragraph, Text } = Typography;

const ContactPage: React.FC = () => {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (_values: any) => {
    setSubmitting(true);
    message.success('感谢您的反馈！我们会尽快处理。');
    setSubmitting(false);
  };

  return (
    <StaticPageLayout title="联系我们">
      <Title level={2}>联系我们</Title>
      <Paragraph style={{ fontSize: 16, lineHeight: 2, marginBottom: 32 }}>
        如果您有任何问题、建议或反馈，欢迎通过以下方式与我们联系。
      </Paragraph>

      <Row gutter={[32, 32]}>
        <Col xs={24} md={12}>
          <Card title="联系方式" style={{ height: '100%' }}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <div>
                <Text strong><MailOutlined style={{ marginRight: 8 }} />电子邮件</Text><br />
                <Text type="secondary">support@classpet.example.com</Text>
              </div>
              <div>
                <Text strong><MessageOutlined style={{ marginRight: 8 }} />在线反馈</Text><br />
                <Text type="secondary">请使用右侧表单提交您的问题或建议</Text>
              </div>
              <div>
                <Text strong><GithubOutlined style={{ marginRight: 8 }} />开源项目</Text><br />
                <Text type="secondary">欢迎参与项目开发和问题反馈</Text>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="提交反馈" style={{ height: '100%' }}>
            <Form layout="vertical" onFinish={handleSubmit}>
              <Form.Item name="name" label="您的称呼" rules={[{ required: true, message: '请输入您的称呼' }]}>
                <Input placeholder="请输入您的称呼" />
              </Form.Item>
              <Form.Item name="email" label="联系邮箱" rules={[{ required: true, message: '请输入联系邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}>
                <Input placeholder="请输入联系邮箱" />
              </Form.Item>
              <Form.Item name="subject" label="主题" rules={[{ required: true, message: '请输入主题' }]}>
                <Input placeholder="请输入主题" />
              </Form.Item>
              <Form.Item name="message" label="内容" rules={[{ required: true, message: '请输入内容' }]}>
                <Input.TextArea rows={4} placeholder="请详细描述您的问题或建议" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting} block>提交</Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </StaticPageLayout>
  );
};

export default ContactPage;
