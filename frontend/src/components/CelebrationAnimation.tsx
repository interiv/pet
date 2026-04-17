import React, { useEffect, useState } from 'react';
import { usePetStore } from '../store/authStore';

interface CelebrationProps {
  show: boolean;
  expReward?: number;
  goldReward?: number;
  leveledUp?: boolean;
  newLevel?: number;
  evolved?: boolean;
  newStage?: string;
}

const CelebrationAnimation: React.FC<CelebrationProps> = ({
  show,
  expReward = 0,
  goldReward = 0,
  leveledUp = false,
  newLevel = 0,
  evolved = false,
  newStage = ''
}) => {
  const { pet } = usePetStore();
  const [animations, setAnimations] = useState<Array<{
    id: number;
    type: 'exp' | 'gold' | 'level' | 'evolve';
    text: string;
    x: number;
    y: number;
  }>>([]);

  useEffect(() => {
    if (show) {
      const newAnimations: any[] = [];
      let id = Date.now();

      // 经验值飘字
      if (expReward > 0) {
        newAnimations.push({
          id: id++,
          type: 'exp',
          text: `+${expReward} EXP`,
          x: 30 + Math.random() * 40,
          y: 50
        });
      }

      // 金币飘字
      if (goldReward > 0) {
        newAnimations.push({
          id: id++,
          type: 'gold',
          text: `+${goldReward} 💰`,
          x: 50 + Math.random() * 20,
          y: 50
        });
      }

      // 升级动画
      if (leveledUp) {
        newAnimations.push({
          id: id++,
          type: 'level',
          text: `🎉 升级到 Lv.${newLevel}!`,
          x: 50,
          y: 40
        });
      }

      // 进化动画
      if (evolved && newStage) {
        newAnimations.push({
          id: id++,
          type: 'evolve',
          text: `✨ 进化为 ${newStage}!`,
          x: 50,
          y: 30
        });
      }

      setAnimations(newAnimations);

      // 5秒后清除动画
      const timer = setTimeout(() => {
        setAnimations([]);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [show, expReward, goldReward, leveledUp, newLevel, evolved, newStage]);

  if (!show || animations.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      pointerEvents: 'none',
      zIndex: 9999
    }}>
      {/* 宠物欢呼动画 */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        animation: 'celebration-bounce 0.6s ease-in-out infinite'
      }}>
        <div style={{ fontSize: 80 }}>
          {pet ? (
            <img
              src={(() => {
                try {
                  const urls = typeof pet.image_urls === 'string' ? JSON.parse(pet.image_urls) : pet.image_urls;
                  return urls[pet.growth_stage] || urls['成年期'] || Object.values(urls)[0] || '';
                } catch (e) {
                  return '';
                }
              })()}
              alt="宠物"
              style={{
                width: 120,
                height: 120,
                objectFit: 'contain',
                filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.3))'
              }}
            />
          ) : (
            '🎉'
          )}
        </div>
      </div>

      {/* 飘字动画 */}
      {animations.map((anim) => (
        <div
          key={anim.id}
          style={{
            position: 'absolute',
            left: `${anim.x}%`,
            top: `${anim.y}%`,
            animation: 'float-up 2s ease-out forwards',
            fontSize: anim.type === 'level' || anim.type === 'evolve' ? 32 : 24,
            fontWeight: 'bold',
            color: anim.type === 'exp' ? '#52c41a' :
                   anim.type === 'gold' ? '#faad14' :
                   anim.type === 'level' ? '#1890ff' :
                   '#722ed1',
            textShadow: '2px 2px 4px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap'
          }}
        >
          {anim.text}
        </div>
      ))}

      {/* CSS动画定义 */}
      <style>{`
        @keyframes celebration-bounce {
          0%, 100% {
            transform: translate(-50%, -50%) scale(1) rotate(0deg);
          }
          25% {
            transform: translate(-50%, -60%) scale(1.1) rotate(-5deg);
          }
          50% {
            transform: translate(-50%, -50%) scale(1.2) rotate(0deg);
          }
          75% {
            transform: translate(-50%, -60%) scale(1.1) rotate(5deg);
          }
        }

        @keyframes float-up {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          50% {
            opacity: 1;
            transform: translateY(-80px) scale(1.2);
          }
          100% {
            opacity: 0;
            transform: translateY(-160px) scale(0.8);
          }
        }

        @keyframes sparkle {
          0%, 100% {
            opacity: 0;
            transform: scale(0);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
};

export default CelebrationAnimation;
