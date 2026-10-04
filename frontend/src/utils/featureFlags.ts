export interface FeatureFlagMeta {
  key: string;
  label: string;
  hint: string;
}
export interface FeatureFlagGroup {
  title: string;
  tip: string;
  flags: FeatureFlagMeta[];
}
/**
 * 功能开关清单（前端侧）。
 *
 * key 必须与 backend/src/middleware/featureFlags.js 的 DEFAULT_FLAGS 完全一致，
 * 否则会出现「前端能显示、后端读不到」的假开关。
 *
 * 分组只用于管理后台的展示顺序；默认值以后端为准
 * （后端 public 接口已按默认值补齐每个 key）。
 */
export const FLAG_GROUPS: FeatureFlagGroup[] = [
  {
    title: '注册与对外访问',
    tip: '用于公开演示、校内封闭使用等场景。',
    flags: [
      {
        key: 'registration_enabled',
        label: '开放注册',
        hint: '关闭后任何人（含凭邀请码）都无法自助注册或加入班级，账号只能由管理员在后台创建',
      },
      {
        key: 'class_public_enabled',
        label: '班级公开主页',
        hint: '关闭后未登录访客无法访问班级公开主页，也看不到公开班级列表',
      },
    ],
  },
  {
    title: 'AI 能力',
    tip: 'AI 会消耗 Token。出现故障、异常刷量或只想省成本时可在此一键停用。',
    flags: [
      {
        key: 'ai_enabled',
        label: 'AI 功能总开关',
        hint: '关闭后 AI 出题、AI 批改、学情报告、AI 教练、课堂做题 AI 出题全部停用',
      },
      {
        key: 'ai_paper_judge_enabled',
        label: 'AI 批改纸质作业',
        hint: '单独关闭「拍照识别判分」与「批量扫描」，可改用手动登记',
      },
      {
        key: 'paper_upload_enabled',
        label: '纸质作业拍照上传',
        hint: '关闭后不能再上传纸质作业照片（与 AI 判分解耦）',
      },
    ],
  },
  {
    title: '游戏化玩法',
    tip: '关闭后对应的宠物中心页签会隐藏，相关接口也会被拒绝。',
    flags: [
      { key: 'battle_enabled', label: 'PVP 对战', hint: '关闭学生之间的宠物对战（含好友对战）' },
      {
        key: 'boss_battle_enabled',
        label: 'BOSS 战',
        hint: '教师组织的全班 BOSS 挑战，与 PVP 独立控制',
      },
      { key: 'shop_enabled', label: '道具商店', hint: '关闭道具购买与货架' },
      { key: 'equipment_shop_enabled', label: '装备商店', hint: '关闭装备购买与强化' },
    ],
  },
];

export const FEATURE_FLAGS: FeatureFlagMeta[] = FLAG_GROUPS.reduce(
  (acc, g) => acc.concat(g.flags),
  [] as FeatureFlagMeta[]
);

/** 读取后端下发的开关值；只有显式 false 视为关闭。 */
export function flagEnabled(settings: any, key: string): boolean {
  return settings?.[key] !== 'false';
}