export function getPetImageUrl(pet: any, stage?: string): string {
  try {
    const urls = typeof pet.image_urls === 'string' ? JSON.parse(pet.image_urls) : pet.image_urls;
    if (urls && typeof urls === 'object' && Object.keys(urls).length > 0) {
      const growthStage = stage || pet.growth_stage || '成年期';
      return urls[growthStage] || urls['成年期'] || Object.values(urls)[0] || '';
    }
  } catch {
    // fall through to fallback
  }

  // 使用宠物名字来构建路径 - 同时支持 species.name 和 species_name
  const speciesName = pet.species_name || pet.name || '';
  const growthStage = stage || pet.growth_stage || '成年期';
  if (speciesName) {
    // 直接使用缩略图
    return `/images/pets/${speciesName}/${growthStage}_thumb.png`;
  }
  return '';
}

export function getPetThumbUrl(pet: any, stage?: string): string {
  // 现在直接使用 getPetImageUrl，因为数据库已经存储缩略图路径了
  return getPetImageUrl(pet, stage);
}

export function getThumbUrl(imageUrl: string | null | undefined): string {
  if (!imageUrl) return '';
  if (!imageUrl.startsWith('http') && !imageUrl.startsWith('/')) return imageUrl;
  // 如果已经是缩略图就直接返回，否则替换成缩略图
  if (imageUrl.includes('_thumb.png')) {
    return imageUrl;
  }
  return imageUrl.replace(/\.png$/, '_thumb.png');
}

/* ===== 下面是名录页 / 班级宠物页共用的展示小工具 ===== */

/** 元素（属性）配色，首页图鉴与班级宠物卡片用同一套 */
export const elementColors: Record<string, string> = {
  '火': '#ff4d4f', '水': '#1890ff', '风': '#52c41a', '草': '#52c41a', '土': '#d48806',
  '光': '#faad14', '暗': '#722ed1', '火系': '#ff4d4f', '水系': '#1890ff',
  '风系': '#52c41a', '草系': '#52c41a', '土系': '#d48806',
  '光系': '#faad14', '暗系': '#722ed1',
  fire: '#ff4d4f', water: '#1890ff', grass: '#52c41a', wind: '#52c41a',
  earth: '#d48806', light: '#faad14', dark: '#722ed1',
};

/**
 * 库里 element_type 存的是英文（fire/water/grass/light/dark），
 * 直接把 'grass' 打到界面上很怪，统一翻成中文再展示。
 */
export const elementLabels: Record<string, string> = {
  fire: '火', water: '水', grass: '草', wind: '风', earth: '土', light: '光', dark: '暗',
};

/** 取属性配色：先翻中文再查表，查不到给个中性色 */
export function elementColor(elementType?: string): string {
  if (!elementType) return '#667eea';
  return elementColors[elementLabels[elementType] || elementType] || '#667eea';
}

/**
 * 取属性的中文标签。
 *
 * element_type 存的是英文键（fire/water/grass…），直接打到界面上很怪。
 * elementColor() 内部已经翻过一次中文，但那只影响颜色；
 * 文案要单独翻一遍，两处共用同一张 elementLabels 表，改一处不会漏另一处。
 */
export function elementLabel(elementType?: string): string {
  if (!elementType) return '';
  return elementLabels[elementType] || elementType;
}

/**
 * 物种图（首页图鉴用）。
 * 那里手上只有物种的 image_urls 与物种名，没有 pet 对象，
 * 所以包一层：按成年期取图，再统一换成缩略图。
 */
export function getSpeciesImage(imageUrls: string | object | null, speciesName: string = ''): string {
  return getThumbUrl(getPetImageUrl({ image_urls: imageUrls, species_name: speciesName, growth_stage: '成年期' }));
}

export function growthStageEmoji(stage?: string): string {
  const emojis: Record<string, string> = {
    '宠物蛋': '🥚',
    '初生期': '🐣',
    '幼年期': '🐾',
    '成长期': '🌱',
    '成年期': '🦅',
    '完全体': '✨',
    '究极体': '🌟',
  };
  return emojis[stage || ''] || '🐾';
}

/** 宠物状态 → 展示文案与配色（pets.status 目前只有 normal / unconscious 两种取值） */
export function petStatusMeta(status?: string): { label: string; color: string } {
  if (status === 'unconscious') return { label: '濒死', color: '#f5222d' };
  if (status === 'dead') return { label: '已死亡', color: '#8c8c8c' };
  return { label: '存活', color: '#52c41a' };
}
