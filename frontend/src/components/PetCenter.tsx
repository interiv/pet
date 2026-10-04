import React, { useEffect, useCallback } from 'react';
import { Tabs } from 'antd';
import { HomeOutlined, ThunderboltOutlined, ShoppingOutlined, GiftOutlined, SkinOutlined, TrophyOutlined, FireOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { usePetStore, useSiteSettingsStore } from '../store/authStore';
import { flagEnabled } from '../utils/featureFlags';
import { petAPI } from '../utils/api';
import PetDisplay from './PetDisplay';
import CreatePet from './CreatePet';
import PetSkills from './PetSkills';
import ShopAndBackpack from './ShopAndBackpack';
import { EquipmentPanel } from './EquipmentPanel';
import Battle from './Battle';
import BossBattle from './BossBattle';

interface PetCenterProps {
  onNavigate?: (menu: string) => void;
}

const PetCenter: React.FC<PetCenterProps> = ({ onNavigate: _onNavigate }) => {
  const { pet, setPet, hasPet } = usePetStore();
  const siteSettings = useSiteSettingsStore((s) => s.settings);
  const loadSiteSettings = useSiteSettingsStore((s) => s.loadSiteSettings);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'pet';

  const loadPetData = useCallback(async () => {
    try {
      const response = await petAPI.getMyPet();
      setPet(response.data.pet);
    } catch (error) {
      console.error('加载宠物数据失败:', error);
    }
  }, [setPet]);

  useEffect(() => {
    if (!hasPet) {
      loadPetData();
    }
  }, [hasPet, loadPetData]);

  // 功能开关（道具商店/装备商店/PVP/BOSS）需要先拿到才能决定显示哪些页签
  useEffect(() => {
    loadSiteSettings();
  }, [loadSiteSettings]);

  const handleTabChange = (key: string) => {
    setSearchParams(prev => {
      prev.set('tab', key);
      prev.delete('sub');
      return prev;
    }, { replace: true });
  };

  // 页签按后台「网站设置 → 功能开关」动态隐藏；后端接口同样会被拒绝，
  // 这里只是避免用户点进一个必然报错的空页面
  const allItems = [
    {
      key: 'pet',
      label: '我的宠物',
      icon: <HomeOutlined />,
      children: hasPet ? <PetDisplay pet={pet} onNavigate={handleTabChange} /> : <CreatePet onSuccess={loadPetData} />,
    },
    {
      key: 'backpack',
      label: '我的背包',
      icon: <GiftOutlined />,
      children: <ShopAndBackpack viewMode="backpack" />,
    },
    {
      key: 'skills',
      label: '技能培养',
      icon: <ThunderboltOutlined />,
      children: <PetSkills />,
    },
    {
      key: 'shop',
      flag: 'shop_enabled',
      label: '道具商店',
      icon: <ShoppingOutlined />,
      children: <ShopAndBackpack viewMode="shop" />,
    },
    {
      key: 'equipment',
      flag: 'equipment_shop_enabled',
      label: '装备商店',
      icon: <SkinOutlined />,
      children: <EquipmentPanel />,
    },
    {
      key: 'pvp',
      flag: 'battle_enabled',
      label: 'PVP 对战',
      icon: <TrophyOutlined />,
      children: <Battle />,
    },
    {
      key: 'boss',
      flag: 'boss_battle_enabled',
      label: 'BOSS 战',
      icon: <FireOutlined />,
      children: <BossBattle />,
    },
  ];

  const items = allItems.filter((it: any) => !it.flag || flagEnabled(siteSettings, it.flag));

  // 关掉的页签可能正停留在 URL 上（?tab=shop），回退到第一个可用页签避免白屏
  useEffect(() => {
    if (items.length > 0 && !items.some((i: any) => i.key === activeTab)) {
      handleTabChange(items[0].key);
    }
  }, [activeTab, items.map((i: any) => i.key).join(',')]);

  return (
    <Tabs
      activeKey={activeTab}
      onChange={handleTabChange}
      items={items}
      destroyOnHidden
    />
  );
};

export default PetCenter;
