const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat } = require('docx');
const fs = require('fs');

const doc = new Document({
  styles: {
    default: { document: { run: { font: "微软雅黑", size: 24 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal",
        run: { size: 48, bold: true, color: "000000", font: "微软雅黑" },
        paragraph: { spacing: { before: 240, after: 120 }, alignment: AlignmentType.CENTER } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, color: "2E74B5", font: "微软雅黑" },
        paragraph: { spacing: { before: 300, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, color: "000000", font: "微软雅黑" },
        paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } }
    ]
  },
  numbering: {
    config: [
      { reference: "bullet-list",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "num-list",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }
    ]
  },
  sections: [{
    properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children: [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("班级宠物养成系统")] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 },
        children: [new TextRun({ text: "项目价值介绍", color: "666666", size: 28 })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("一、项目概述")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("班级宠物养成系统是一个将学习与游戏化深度融合的教育科技平台。学生通过完成作业获得经验值来培养专属宠物，激励学习动力老师可通过系统可视化追踪学生学习进度。")
      ] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("二、核心价值")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("2.1 教育价值")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("学习动力激发：通过游戏化的宠物养成，让作业从任务变成期待")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("行为习惯培养：每日任务系统帮助学生养成持续学习的习惯")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("学习进度可视化：宠物成长阶段直反映学习成果，增强成就感")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 200 },
        children: [new TextRun("AI智能辅助：自动批改主观题，减轻教师工作负担")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("2.2 社会价值")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("班级凝聚力：宠物对战、排行榜等社交功能增进同学间互动")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("健康竞争：通过友好的竞技机制激发学习积极性")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 200 },
        children: [new TextRun("亲子互动：家长可查看孩子宠物成长情况，参与学习过程")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("三、目标用户")] }),
      new Paragraph({ numbering: { reference: "num-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("小学生/初中生：系统的主要使用者，通过平台完成作业、培养宠物")] }),
      new Paragraph({ numbering: { reference: "num-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("学校教师：管理班级、查看学生作业进度、数据统计")] }),
      new Paragraph({ numbering: { reference: "num-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("学生家长：了解孩子学习情况、宠物成长状态")] }),
      new Paragraph({ numbering: { reference: "num-list", level: 0 }, spacing: { after: 200 },
        children: [new TextRun("教育机构：作为辅助教学工具，提升学生参与度")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("四、竞争优势")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("完整的游戏化闭环：养成-对战-社交-成就，覆盖学习全场景")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("丰富的宠物系统：20+宠物类型，7个成长阶段，高度可玩性")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("AI技术融合：智能作业批改，降低教师工作量")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("成熟的 技术栈：Node.js + React，稳定可靠易于维护")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 200 },
        children: [new TextRun("开源可扩展：代码结构清晰，便于二次开发和定制")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("五、应用场景")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("课后作业管理：学生在线完成作业，教师在线批改")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("假期学习激励：利用宠物养成机制，保持学生假期学习习惯")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 100 },
        children: [new TextRun("班级活动组织：通过宠物对战、排行榜开展班级竞赛")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { after: 200 },
        children: [new TextRun("课外兴趣培养：宠物知识科普，增强自然科学学习兴趣")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("六、未来展望")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("未来我们将持续优化用户体验，引入更多AI能力（如智能出题、个性化学习推荐），并支持更多教育场景，如课外阅读、实验报告等，打造更完善的教育游戏化生态系统。")
      ] })
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("d:/Learning/pet/项目价值介绍.docx", buffer);
  console.log("文档已生成: d:/Learning/pet/项目价值介绍.docx");
});
