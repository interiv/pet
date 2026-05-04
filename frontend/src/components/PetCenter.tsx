import React, { useEffect, useCallback } from 'react';
import { Tabs } from 'antd';
import { HomeOutlined, ThunderboltOutlined, ShoppingOutlined, GiftOutlined, SkinOutlined, TrophyOutlined, FireOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { usePetStore } from '../store/authStore';
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

  const handleTabChange = (key: string) => {
    setSearchParams(prev => {
      prev.set('tab', key);
      prev.delete('sub');
      return prev;
    }, { replace: true });
  };

  const items = [
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
      label: '宠物技能',
      icon: <ThunderboltOutlined />,
      children: <PetSkills />,
    },
    {
      key: 'shop',
      label: '道具商店',
      icon: <ShoppingOutlined />,
      children: <ShopAndBackpack viewMode="shop" />,
    },
    {
      key: 'equipment',
      label: '装备商店',
      icon: <SkinOutlined />,
      children: <EquipmentPanel />,
    },
    {
      key: 'pvp',
      label: 'PVP 对战',
      icon: <TrophyOutlined />,
      children: <Battle />,
    },
    {
      key: 'boss',
      label: 'BOSS 战',
      icon: <FireOutlined />,
      children: <BossBattle />,
    },
  ];

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
