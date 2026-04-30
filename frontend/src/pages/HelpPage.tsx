import React from 'react';
import { Typography, Steps, Card, Row, Col } from 'antd';
import { UserAddOutlined, HeartOutlined, BookOutlined, TrophyOutlined } from '@ant-design/icons';
import StaticPageLayout from '../components/StaticPageLayout';

const { Title, Paragraph, Text } = Typography;

const HelpPage: React.FC = () => (
  <StaticPageLayout title="使用帮助">
    <Title level={2}>使用帮助</Title>

    <Title level={3}>快速入门</Title>
    <Steps
      direction="vertical"
      current={4}
      items={[
        {
          title: '注册账号',
          description: '点击首页的「注册」按钮，填写用户名、密码等信息完成注册。',
          icon: <UserAddOutlined />,
        },
        {
          title: '加入班级',
          description: '注册后，通过班级邀请码加入你的班级。如果你是学生，需要班主任审批通过后才能进入班级。',
          icon: <HeartOutlined />,
        },
        {
          title: '领养宠物',
          description: '进入班级后，选择一只心仪的宠物伙伴。宠物将陪伴你的学习旅程。',
          icon: <HeartOutlined />,
        },
        {
          title: '完成作业',
          description: '在学习中心完成老师布置的作业，获得经验值和金币奖励，让宠物不断成长。',
          icon: <BookOutlined />,
        },
        {
          title: '挑战排行',
          description: '和同学的宠物进行对战，努力提升等级，冲上排行榜榜首！',
          icon: <TrophyOutlined />,
        },
      ]}
    />

    <Title level={3} style={{ marginTop: 32 }}>角色说明</Title>
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <Card title="🎓 学生" style={{ height: '100%' }}>
          <ul>
            <li>加入班级后领养宠物</li>
            <li>完成作业获取经验值</li>
            <li>投喂和照顾宠物</li>
            <li>与同学宠物对战</li>
            <li>查看个人学习数据</li>
          </ul>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card title="👨‍🏫 教师" style={{ height: '100%' }}>
          <ul>
            <li>管理班级和学生</li>
            <li>布置和批改作业</li>
            <li>查看班级学习数据</li>
            <li>调整学生金币</li>
            <li>管理班级宠物商店</li>
          </ul>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card title="🔧 管理员" style={{ height: '100%' }}>
          <ul>
            <li>管理所有班级和用户</li>
            <li>系统设置和配置</li>
            <li>宠物种类管理</li>
            <li>物品和装备管理</li>
            <li>查看全局统计数据</li>
          </ul>
        </Card>
      </Col>
    </Row>

    <Title level={3} style={{ marginTop: 32 }}>常见问题</Title>
    <Paragraph>
      <Text strong>Q: 如何加入班级？</Text><br />
      A: 注册账号后，在班级选择页面输入班主任提供的邀请码即可申请加入。班主任审批通过后即可进入班级。
    </Paragraph>
    <Paragraph>
      <Text strong>Q: 宠物如何升级？</Text><br />
      A: 完成作业、对战获胜等行为会获得经验值，经验值累积到一定数量后宠物自动升级。升级后宠物属性会提升，外观也可能发生变化。
    </Paragraph>
    <Paragraph>
      <Text strong>Q: 金币有什么用？</Text><br />
      A: 金币可以在商店购买食物、装备等道具，用于投喂宠物或增强宠物战斗力。
    </Paragraph>
    <Paragraph>
      <Text strong>Q: 忘记密码怎么办？</Text><br />
      A: 请联系班主任或管理员重置密码。
    </Paragraph>
  </StaticPageLayout>
);

export default HelpPage;
