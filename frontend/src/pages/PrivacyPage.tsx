import React from 'react';
import { Typography } from 'antd';
import StaticPageLayout from '../components/StaticPageLayout';

const { Title, Paragraph } = Typography;

const PrivacyPage: React.FC = () => (
  <StaticPageLayout title="隐私政策">
    <Title level={2}>隐私政策</Title>
    <Paragraph type="secondary" style={{ fontSize: 13 }}>最后更新日期：2026年1月1日</Paragraph>

    <Title level={3}>1. 信息收集</Title>
    <Paragraph style={{ lineHeight: 2 }}>
      我们收集以下信息用于提供和改善服务：
      <ul>
        <li><b>账号信息</b>：用户名、密码（加密存储）、角色（学生/教师/管理员）</li>
        <li><b>学习数据</b>：作业完成情况、成绩、学习时长等</li>
        <li><b>游戏数据</b>：宠物信息、金币、物品、对战记录等</li>
        <li><b>使用日志</b>：访问时间、操作记录等（用于系统维护和安全）</li>
      </ul>
    </Paragraph>

    <Title level={3}>2. 信息使用</Title>
    <Paragraph style={{ lineHeight: 2 }}>
      收集的信息仅用于以下目的：
      <ul>
        <li>提供和维护班级宠物养成系统的核心功能</li>
        <li>教师查看和管理学生的学习进度</li>
        <li>生成学习报告和统计数据</li>
        <li>改善用户体验和系统功能</li>
        <li>保障系统安全和防止滥用</li>
      </ul>
    </Paragraph>

    <Title level={3}>3. 信息共享</Title>
    <Paragraph style={{ lineHeight: 2 }}>
      我们不会将您的个人信息出售给第三方。信息仅在以下情况下共享：
      <ul>
        <li><b>教师</b>可以查看本班学生的学习数据和宠物信息</li>
        <li><b>班主任</b>可以管理本班学生的账号信息</li>
        <li><b>管理员</b>可以查看和管理系统内的所有数据</li>
        <li>法律法规要求或司法程序需要时</li>
      </ul>
    </Paragraph>

    <Title level={3}>4. 数据安全</Title>
    <Paragraph style={{ lineHeight: 2 }}>
      我们采取合理的技术措施保护您的信息安全，包括数据加密、访问控制等。但请注意，互联网传输不能保证100%的安全。
    </Paragraph>

    <Title level={3}>5. 学生隐私保护</Title>
    <Paragraph style={{ lineHeight: 2 }}>
      鉴于本系统主要面向中小学生，我们特别强调：
      <ul>
        <li>不收集学生的真实姓名、身份证号等敏感信息</li>
        <li>学生数据仅对所在班级的任课教师可见</li>
        <li>不对外公开任何学生的个人信息</li>
        <li>遵守《儿童个人信息网络保护规定》等相关法律法规</li>
      </ul>
    </Paragraph>

    <Title level={3}>6. Cookie 使用</Title>
    <Paragraph style={{ lineHeight: 2 }}>
      本系统使用 localStorage 存储登录状态和用户偏好设置，不使用第三方跟踪 Cookie。
    </Paragraph>

    <Title level={3}>7. 政策更新</Title>
    <Paragraph style={{ lineHeight: 2 }}>
      我们可能会不时更新本隐私政策。更新后的政策将在本页面发布，重大变更会通过系统公告通知用户。
    </Paragraph>

    <Title level={3}>8. 联系我们</Title>
    <Paragraph style={{ lineHeight: 2 }}>
      如对本隐私政策有任何疑问，请通过「联系我们」页面与我们取得联系。
    </Paragraph>
  </StaticPageLayout>
);

export default PrivacyPage;
