import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Select, message, Row, Col, Tag, Image } from 'antd';
import { petAPI } from '../utils/api';
import { usePetStore } from '../store/authStore';

const { Option } = Select;

interface CreatePetProps {
  onSuccess: () => void;
}

const CreatePet: React.FC<CreatePetProps> = ({ onSuccess }) => {
  const [form] = Form.useForm();
  const { setPet } = usePetStore();
  const [loading, setLoading] = useState(false);
  const [speciesList, setSpeciesList] = useState<any[]>([]);

  useEffect(() => {
    // 加载宠物种类列表
    loadSpecies();
  }, []);

  const loadSpecies = async () => {
    try {
      const response = await petAPI.getSpecies();
      setSpeciesList(response.data.species || []);
    } catch (error) {
      console.error('加载宠物种类失败', error);
    }
  };

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      const response = await petAPI.createPet(values);
      setPet(response.data.pet);
      message.success('宠物创建成功！');
      onSuccess();
    } catch (error: any) {
      message.error(error.response?.data?.error || '创建失败');
    } finally {
      setLoading(false);
    }
  };
  
  const [selectedSpecies, setSelectedSpecies] = useState<any>(null);
  
  const handleSpeciesChange = (value: number) => {
    const species = speciesList.find(s => s.id === value);
    setSelectedSpecies(species);
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <Card 
        title="🎉 选择你的初始宠物" 
        extra={<span style={{ fontSize: 24 }}>🥚</span>}
      >
        <p style={{ marginBottom: 24, color: '#666' }}>
          选择一只宠物陪伴你度过学习时光！完成作业可以获得经验值，让你的宠物不断成长！
        </p>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            name="name"
            label="宠物名字"
            rules={[
              { required: true, message: '请输入宠物名字!' },
              { max: 10, message: '名字不能超过 10 个字符!' }
            ]}
          >
            <Input placeholder="给你的宠物起个名字吧" />
          </Form.Item>

          <Form.Item
            name="species_id"
            label="宠物种类"
            rules={[{ required: true, message: '请选择宠物种类!' }]}
          >
            <Select 
              placeholder="选择你喜欢的宠物" 
              optionLabelProp="label"
              onChange={handleSpeciesChange}
            >
              {speciesList.map((species) => (
                <Option key={species.id} value={species.id} label={species.name}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <img src={(() => {
                      try {
                        const urls = typeof species.image_urls === 'string' ? JSON.parse(species.image_urls) : species.image_urls;
                        return urls['宠物蛋'] || urls['幼年期'] || Object.values(urls)[0] || '';
                      } catch (e) {
                        return species.image_urls;
                      }
                    })()} alt={species.name} style={{ width: 40, height: 40, objectFit: 'contain' }} />
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{species.name}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>
                        {species.description}
                        <span style={{ 
                          marginLeft: 8,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: getElementColor(species.element_type),
                          color: '#fff',
                          fontSize: 12
                        }}>
                          {getElementName(species.element_type)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Option>
              ))}
            </Select>
          </Form.Item>
          
          {/* 进化形态预览 */}
          {selectedSpecies && (
            <Card size="small" style={{ marginBottom: 16, background: '#f0f5ff' }}>
              <div style={{ marginBottom: 8 }}>
                <Tag color="blue">进化预览</Tag>
                <span style={{ color: '#666', fontSize: 12 }}> 选择不同的宠物可以看到它们的进化形态</span>
              </div>
              <Row gutter={[8, 8]}>
                {['宠物蛋', '初生期', '幼年期', '成长期', '成年期', '完全体', '究极体'].map((stage, index) => {
                  try {
                    const urls = typeof selectedSpecies.image_urls === 'string' ? JSON.parse(selectedSpecies.image_urls) : selectedSpecies.image_urls;
                    const url = urls[stage] || '';
                    return (
                      <Col span={3} key={stage}>
                        <div style={{ textAlign: 'center' }}>
                          {url ? (
                            <Image 
                              src={url} 
                              alt={stage} 
                              style={{ width: 60, height: 60, objectFit: 'contain' }}
                              preview={false}
                            />
                          ) : (
                            <div style={{ width: 60, height: 60, background: '#e8e8e8', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                              ?
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{stage}</div>
                          <div style={{ fontSize: 10, color: '#999' }}>Lv.{[1, 5, 10, 20, 35, 55, 80][index]}+</div>
                        </div>
                      </Col>
                    );
                  } catch (e) {
                    return null;
                  }
                })}
              </Row>
            </Card>
          )}

          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              size="large"
              block
            >
              开始养成之旅
            </Button>
          </Form.Item>
        </Form>

        <div style={{ marginTop: 24, padding: 16, background: '#f0f2f5', borderRadius: 8 }}>
          <h4 style={{ marginBottom: 12 }}>💡 小提示：</h4>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#666' }}>
            <li>完成作业可以获得经验值</li>
            <li>经验值可以让宠物升级和进化</li>
            <li>不同属性的宠物有不同的特点</li>
            <li>宠物之间可以进行对战</li>
            <li>和其他同学的宠物互动吧</li>
          </ul>
        </div>
      </Card>
    </div>
  );
};

const getElementName = (type: string) => {
  const names: Record<string, string> = {
    'fire': '火',
    'water': '水',
    'grass': '草',
    'light': '光',
    'dark': '暗'
  };
  return names[type] || '普通';
};

const getElementColor = (type: string) => {
  const colors: Record<string, string> = {
    'fire': '#ff4d4f',
    'water': '#1890ff',
    'grass': '#52c41a',
    'light': '#faad14',
    'dark': '#722ed1'
  };
  return colors[type] || '#999';
};

export default CreatePet;
