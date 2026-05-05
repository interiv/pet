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

  const speciesName = pet.species_name || '';
  const growthStage = stage || pet.growth_stage || '成年期';
  if (speciesName) {
    return `/images/pets/${speciesName}/${growthStage}.png`;
  }
  return '';
}

export function getPetThumbUrl(pet: any, stage?: string): string {
  const url = getPetImageUrl(pet, stage);
  if (!url) return '';
  return url.replace(/\.png$/, '_thumb.png');
}

export function getThumbUrl(imageUrl: string | null | undefined): string {
  if (!imageUrl) return '';
  if (!imageUrl.startsWith('http') && !imageUrl.startsWith('/')) return imageUrl;
  return imageUrl.replace(/\.png$/, '_thumb.png');
}
