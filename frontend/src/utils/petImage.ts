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
