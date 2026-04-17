import React, { useEffect, useState } from 'react';

interface FireworkAnimationProps {
  show: boolean;
  title?: string;
  description?: string;
  onComplete?: () => void;
}

const FireworkAnimation: React.FC<FireworkAnimationProps> = ({
  show,
  title = '🎉 成就解锁!',
  description,
  onComplete
}) => {
  const [particles, setParticles] = useState<Array<{
    id: number;
    x: number;
    y: number;
    color: string;
    size: number;
    delay: number;
  }>>([]);

  useEffect(() => {
    if (show) {
      // 生成烟花粒子
      const newParticles = [];
      const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7', '#a29bfe', '#fd79a8', '#00b894'];
      
      for (let i = 0; i < 50; i++) {
        newParticles.push({
          id: Date.now() + i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: Math.random() * 8 + 4,
          delay: Math.random() * 2
        });
      }
      
      setParticles(newParticles);

      // 3秒后自动关闭
      const timer = setTimeout(() => {
        setParticles([]);
        onComplete?.();
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  if (!show) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        animation: 'fade-in 0.3s ease-out'
      }}
      onClick={() => {
        setParticles([]);
        onComplete?.();
      }}
    >
      {/* 烟花粒子 */}
      {particles.map((particle) => (
        <div
          key={particle.id}
          style={{
            position: 'absolute',
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: particle.size,
            height: particle.size,
            borderRadius: '50%',
            backgroundColor: particle.color,
            animation: `firework-explode 1s ease-out ${particle.delay}s forwards`,
            boxShadow: `0 0 ${particle.size * 2}px ${particle.color}`
          }}
        />
      ))}

      {/* 中心内容 */}
      <div
        style={{
          textAlign: 'center',
          color: '#fff',
          animation: 'achievement-flip 0.8s ease-out',
          zIndex: 1
        }}
      >
        <div style={{ fontSize: 80, marginBottom: 20, animation: 'trophy-bounce 1s ease-in-out infinite' }}>
          🏆
        </div>
        <h1 style={{ fontSize: 48, margin: '0 0 16px', textShadow: '0 0 20px rgba(255,255,255,0.5)' }}>
          {title}
        </h1>
        {description && (
          <p style={{ fontSize: 24, margin: 0, opacity: 0.9 }}>
            {description}
          </p>
        )}
        <div style={{ marginTop: 32, fontSize: 16, opacity: 0.7 }}>
          点击任意处关闭
        </div>
      </div>

      {/* CSS动画 */}
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes firework-explode {
          0% {
            transform: scale(0) translate(0, 0);
            opacity: 1;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: scale(2) translate(${Math.random() * 100 - 50}px, ${Math.random() * 100 - 50}px);
            opacity: 0;
          }
        }

        @keyframes achievement-flip {
          0% {
            transform: rotateY(180deg) scale(0.5);
            opacity: 0;
          }
          60% {
            transform: rotateY(-10deg) scale(1.1);
          }
          100% {
            transform: rotateY(0deg) scale(1);
            opacity: 1;
          }
        }

        @keyframes trophy-bounce {
          0%, 100% {
            transform: scale(1) rotate(0deg);
          }
          25% {
            transform: scale(1.2) rotate(-10deg);
          }
          50% {
            transform: scale(1) rotate(0deg);
          }
          75% {
            transform: scale(1.2) rotate(10deg);
          }
        }
      `}</style>
    </div>
  );
};

export default FireworkAnimation;
