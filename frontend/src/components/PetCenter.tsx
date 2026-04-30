import React, { useState, useEffect, useCallback } from 'react';
import { Tabs } from 'antd';
import { HomeOutlined, ThunderboltOutlined, ShoppingOutlined, GiftOutlined } from '@ant-design/icons';
import { usePetStore } from '../store/authStore';
import { petAPI } from '../utils/api';
import PetDisplay from './PetDisplay';
import CreatePet from './CreatePet';
import PetSkills from './PetSkills';
import ShopAndBackpack from './ShopAndBackpack';

interface PetCenterProps {
  defaultTab?: 'pet' | 'backpack' | 'skills' | 'shop';
  onNavigate?: (menu: string) => void;
}

const PetCenter: React.FC<PetCenterProps> = ({ defaultTab = 'pet', onNavigate: _onNavigate }) => {
  const { pet, setPet, hasPet } = usePetStore();
  const [activeTab, setActiveTab] = useState(defaultTab);

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
    setActiveTab(key as 'pet' | 'backpack' | 'skills' | 'shop');
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
  ];

  return (
    <Tabs
      activeKey={activeTab}
      onChange={handleTabChange}
      items={items}
    />
  );
};

export default PetCenter;
