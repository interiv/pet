import React from 'react';
import { Empty, Progress } from 'antd';
import { Pie, Column, Line, Bar, Heatmap } from '@ant-design/charts';

/**
 * 通用图表封装组件。
 * 提供常用的教育场景图表（环形、柱状、折线、条形、热力图），
 * 统一处理空数据与默认配置，避免每处重复 import。
 *
 * 所有组件均支持 data 空数组的兜底渲染。
 */

interface BaseProps {
  height?: number;
}

// 环形图：整体掌握率（用 antd Progress 实现，避免额外图表依赖）
export const MasteryRing: React.FC<{ percent: number; label?: string; height?: number; color?: string }> = ({
  percent, label = '已掌握', height = 160, color = '#52c41a'
}) => {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height }}>
      <Progress
        type="dashboard"
        percent={safePercent}
        width={height - 30}
        strokeColor={color}
        format={(p) => <span style={{ color, fontWeight: 'bold' }}>{p}%</span>}
      />
      <div style={{ marginTop: 4, color: '#999', fontSize: 12 }}>{label}</div>
    </div>
  );
};

// 饼图：知识点分布 / 题型分布
export const DistributionPie: React.FC<BaseProps & {
  data: Array<{ type: string; value: number }>;
  innerRadius?: number;
}> = ({ data, height = 260, innerRadius = 0.55 }) => {
  if (!data || data.length === 0) return <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Pie
      height={height}
      data={data}
      angleField="value"
      colorField="type"
      innerRadius={innerRadius}
      label={{ style: { fontSize: 12 }, text: (d: any) => `${d.type}\n${d.value}` }}
      legend={{ color: { position: 'bottom' } }}
    />
  );
};

// 柱状图：不同科目/知识点的正确率
export const AccuracyColumn: React.FC<BaseProps & {
  data: Array<{ name: string; accuracy: number }>;
  xField?: string;
  yField?: string;
  colorTarget?: number; // 目标线
}> = ({ data, height = 280, xField = 'name', yField = 'accuracy', colorTarget = 80 }) => {
  if (!data || data.length === 0) return <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Column
      height={height}
      data={data}
      xField={xField}
      yField={yField}
      axis={{ y: { labelFormatter: (v: number) => `${v}%` } }}
      style={{
        fill: ({ accuracy }: any) => {
          if (accuracy >= 90) return '#52c41a';
          if (accuracy >= colorTarget) return '#1677ff';
          if (accuracy >= 60) return '#faad14';
          return '#f5222d';
        }
      }}
      label={{ text: (d: any) => `${d[yField]}%`, position: 'top', style: { fontSize: 11 } }}
    />
  );
};

// 折线图：正确率/掌握度随时间变化
export const TrendLine: React.FC<BaseProps & {
  data: Array<{ date: string; value: number; category?: string }>;
  xField?: string;
  yField?: string;
  seriesField?: string;
  yAxisLabel?: string;
}> = ({ data, height = 260, xField = 'date', yField = 'value', seriesField = 'category', yAxisLabel = '%' }) => {
  if (!data || data.length === 0) return <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const hasSeries = data.some(d => d.category);
  return (
    <Line
      height={height}
      data={data}
      xField={xField}
      yField={yField}
      colorField={hasSeries ? seriesField : undefined}
      axis={{ y: { labelFormatter: (v: number) => `${v}${yAxisLabel}` } }}
      point={{ shapeField: 'circle', sizeField: 3 }}
      smooth
    />
  );
};

// 条形图：薄弱知识点排行
export const WeakPointBar: React.FC<BaseProps & {
  data: Array<{ name: string; accuracy: number }>;
}> = ({ data, height = 280 }) => {
  if (!data || data.length === 0) return <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Bar
      height={height}
      data={data}
      xField="accuracy"
      yField="name"
      axis={{ x: { labelFormatter: (v: number) => `${v}%` } }}
      style={{
        fill: ({ accuracy }: any) => {
          if (accuracy < 40) return '#f5222d';
          if (accuracy < 60) return '#fa8c16';
          if (accuracy < 80) return '#faad14';
          return '#52c41a';
        }
      }}
      label={{ text: (d: any) => `${d.accuracy}%`, position: 'right', style: { fontSize: 11 } }}
    />
  );
};

// 热力图：N天 x 知识点的练习频率
export const LearningHeatmap: React.FC<BaseProps & {
  data: Array<{ date: string; knowledge_point: string; value: number }>;
}> = ({ data, height = 320 }) => {
  if (!data || data.length === 0) return <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Heatmap
      height={height}
      data={data}
      xField="date"
      yField="knowledge_point"
      colorField="value"
      style={{ inset: 0.5 }}
      scale={{ color: { range: ['#f7fbff', '#bae0ff', '#69b1ff', '#1677ff', '#003a8c'] } }}
      axis={{ x: { labelAutoRotate: true } }}
    />
  );
};

// 柱状图：通用数值柱状图（不带百分比后缀，适用于答题量/时长等）
export const CountColumn: React.FC<BaseProps & {
  data: Array<{ name: string; value: number }>;
  xField?: string;
  yField?: string;
  unit?: string;
  color?: string;
}> = ({ data, height = 220, xField = 'name', yField = 'value', unit = '', color = '#1677ff' }) => {
  if (!data || data.length === 0) return <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <Column
      height={height}
      data={data}
      xField={xField}
      yField={yField}
      axis={{ y: { labelFormatter: (v: number) => `${v}${unit}` } }}
      style={{ fill: color }}
      label={{ text: (d: any) => `${d[yField]}`, position: 'top', style: { fontSize: 11 } }}
    />
  );
};

export default {
  MasteryRing,
  DistributionPie,
  AccuracyColumn,
  CountColumn,
  TrendLine,
  WeakPointBar,
  LearningHeatmap
};
