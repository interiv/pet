import React, { useEffect, useState, useMemo } from 'react';
import { Card, Button, Input, message, Tag, Space, Modal, Alert, Spin, Collapse } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { adminAPI } from '../../utils/api';
import { PromptItem } from './_common';

const PromptSettings: React.FC = () => {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadPrompts(); }, []);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getPromptSettings();
      const list: PromptItem[] = res.data.prompts || [];
      setPrompts(list);
      const map: Record<string, string> = {};
      list.forEach(p => { map[p.key] = p.value; });
      setValues(map);
    } catch (e) {
      message.error('加载提示词设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminAPI.savePromptSettings(values);
      message.success('提示词已保存（内容与默认相同或留空的项，将自动恢复为默认）');
      loadPrompts();
    } catch (e) {
      message.error('保存提示词失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = (keys: string[], all = false) => {
    Modal.confirm({
      title: all ? '确认恢复全部提示词为默认？' : '确认恢复该提示词为默认？',
      content: '恢复后系统将使用代码内置的默认提示词，自定义内容将被清除。',
      okText: '确认恢复',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await adminAPI.resetPromptSettings(all ? undefined : keys);
          message.success('已恢复为默认提示词');
          loadPrompts();
        } catch (e) {
          message.error('恢复默认失败');
        }
      }
    });
  };

  const groups = useMemo(() => {
    const map: Record<string, PromptItem[]> = {};
    for (const p of prompts) {
      if (!map[p.group]) map[p.group] = [];
      map[p.group].push(p);
    }
    return map;
  }, [prompts]);

  return (
    <Card
      title={<span><FileTextOutlined /> AI 提示词设置</span>}
      style={{ marginTop: 24 }}
      extra={
        <Space>
          <Button danger onClick={() => handleReset([], true)}>全部恢复默认</Button>
          <Button type="primary" onClick={handleSave} loading={saving}>保存全部提示词</Button>
        </Space>
      }
    >
      <Alert
        message="说明"
        description="这里列出系统中所有 AI 提示词，文本框中显示的即当前生效内容（默认或自定义）。修改后点击右上角「保存全部提示词」生效；把内容改回与默认一致或留空，保存后即恢复为默认。模板中的 {xxx} 为变量占位符，运行时自动替换，请勿删除。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Spin spinning={loading}>
        <Collapse
          defaultActiveKey={[]}
          items={Object.entries(groups).map(([group, list]) => ({
            key: group,
            label: <span>{group}<Tag style={{ marginLeft: 8 }}>{list.length} 个</Tag></span>,
            children: list.map(p => (
              <div key={p.key} style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px dashed #eee' }}>
                <div style={{ marginBottom: 4 }}>
                  <Space>
                    <span style={{ fontWeight: 500 }}>{p.label}</span>
                    {p.is_custom ? <Tag color="orange">已自定义</Tag> : <Tag color="green">默认</Tag>}
                    {p.has_custom && !p.is_custom && <Tag>内容与默认相同</Tag>}
                  </Space>
                </div>
                <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>{p.description}</div>
                <Input.TextArea
                  rows={6}
                  autoSize={{ minRows: 6, maxRows: 24 }}
                  value={values[p.key] || ''}
                  onChange={(e) => setValues(prev => ({ ...prev, [p.key]: e.target.value }))}
                />
                <div style={{ marginTop: 8, textAlign: 'right' }}>
                  <Button size="small" onClick={() => handleReset([p.key])}>恢复默认</Button>
                </div>
              </div>
            ))
          }))}
        />
      </Spin>
    </Card>
  );
};

export { PromptSettings };
export default PromptSettings;
