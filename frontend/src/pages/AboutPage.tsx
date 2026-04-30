import React from 'react';
import { Typography } from 'antd';
import StaticPageLayout from '../components/StaticPageLayout';

const { Title, Paragraph } = Typography;

const AboutPage: React.FC = () => (
  <StaticPageLayout title="关于我们">
    <Title level={2}>关于班级宠物养成系统</Title>
    <Paragraph style={{ fontSize: 16, lineHeight: 2 }}>
      班级宠物养成系统是一款专为中小学课堂设计的教育辅助工具。我们相信，学习不应是枯燥的——通过游戏化的方式，
      让学生在完成作业、掌握知识的同时，养育属于自己的虚拟宠物，体验成长的乐趣。
    </Paragraph>
    <Title level={3}>我们的理念</Title>
    <Paragraph style={{ fontSize: 15, lineHeight: 2 }}>
      寓教于乐，让学习更有趣。我们希望通过宠物养成机制，激发学生的内在学习动力，
      培养良好的学习习惯，同时增强班级凝聚力和同学间的良性互动。
    </Paragraph>
    <Title level={3}>核心功能</Title>
    <Paragraph style={{ fontSize: 15, lineHeight: 2 }}>
      <ul>
        <li>🐾 宠物养成 — 选择心仪的宠物伙伴，通过学习让它不断成长进化</li>
        <li>📚 作业系统 — 完成作业获得经验值和金币奖励</li>
        <li>⚔️ 宠物对战 — 和同学的宠物一决高下，用知识的力量战斗</li>
        <li>🏆 排行榜 — 看看谁的宠物最强，努力学习冲上榜首</li>
        <li>🎒 物品商店 — 用金币购买道具和装备，装扮你的宠物</li>
        <li>📊 数据统计 — 教师和家长可以查看学习进度和成绩数据</li>
      </ul>
    </Paragraph>
    <Title level={3}>技术支持</Title>
    <Paragraph style={{ fontSize: 15, lineHeight: 2 }}>
      如有任何问题或建议，请通过「联系我们」页面与我们取得联系。
    </Paragraph>
  </StaticPageLayout>
);

export default AboutPage;
