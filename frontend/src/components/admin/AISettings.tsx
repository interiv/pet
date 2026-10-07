import React, { useEffect, useState } from 'react';
import { Card, Button, Form, Input, message, Space, Alert, Divider, Select, Switch } from 'antd';
import { ThunderboltOutlined, RobotOutlined } from '@ant-design/icons';
import { adminAPI } from '../../utils/api';
import PromptSettings from './PromptSettings';

const AISettings: React.FC = () => {
  const [settingsForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; ai_reply?: string; elapsed?: string; detail?: string } | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await adminAPI.getSiteSettings();
      const data = res.data.settings || {};
      setHasApiKey(data.ai_api_key === '***');
      settingsForm.setFieldsValue({
        ai_model: data.ai_model || 'gpt-3.5-turbo',
        ai_vision_model: data.ai_vision_model || '',
        ai_base_url: data.ai_base_url || 'https://api.openai.com/v1',
        ai_api_key: data.ai_api_key || '',
        ai_api_mode: data.ai_api_mode || 'chat',
        ai_thinking_enabled: data.ai_thinking_enabled === 'true',
        ai_thinking_effort: data.ai_thinking_effort || 'medium',
        ai_thinking_budget: data.ai_thinking_budget || '0',
        ai_thinking_summary: data.ai_thinking_summary || '',
        ai_report_interval_days: data.ai_report_interval_days || '3',
        ai_timeout: data.ai_timeout || '300',
        max_tokens_per_generation: data.max_tokens_per_generation || '18000',
        daily_teacher_gen_limit: data.daily_teacher_gen_limit || '20',
        daily_global_token_limit: data.daily_global_token_limit || '2000000',
        max_questions_per_generation: data.max_questions_per_generation || '20',
        ai_gen_max_rounds: data.ai_gen_max_rounds || '3',
      });
    } catch (error) {
      message.error('加载设置失败');
    }
  };

  const handleSave = async (values: any) => {
    setLoading(true);
    try {
      // 如果 API Key 是掩码或空，不发送到后端
      const saveValues = { ...values };
      if (!saveValues.ai_api_key || saveValues.ai_api_key === '***') {
        delete saveValues.ai_api_key;
      }
      // 开关用 Switch 拿到的是 boolean，后端枚举白名单按字符串校验，这里统一转换
      saveValues.ai_thinking_enabled = saveValues.ai_thinking_enabled ? 'true' : 'false';
      await adminAPI.saveSiteSettings(saveValues);
      message.success('大模型设置已保存');
      setTestResult(null);
      // 重新加载以刷新 API Key 掩码状态
      loadSettings();
    } catch (error) {
      message.error('保存设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    try {
      const values = settingsForm.getFieldsValue();
      // *** 表示已有密钥，后端会自动读取
      const hasKey = values.ai_api_key && values.ai_api_key !== '';
      if (!values.ai_model || !values.ai_base_url || !hasKey) {
        message.warning('请先填写完整的 AI 配置（模型、地址、API Key）');
        return;
      }
      setTesting(true);
      setTestResult(null);
      const res = await adminAPI.testAIConnection(values);
      setTestResult({
        success: true,
        message: res.data.message,
        ai_reply: res.data.ai_reply,
        elapsed: res.data.elapsed,
        detail: res.data.degraded ? '部分参数不被支持，已自动降级' : undefined,
      });
      message.success('连接测试成功！');
    } catch (error: any) {
      const errData = error.response?.data || {};
      setTestResult({
        success: false,
        message: errData.error || '连接失败',
        detail: errData.detail || error.message,
      });
      message.error('连接测试失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
    <Card title={<span><RobotOutlined /> AI 大模型配置</span>} style={{ maxWidth: 600 }}>{hasApiKey && (
        <Alert
          message="API Key 已配置"
          description="出于安全考虑，已保存的 API Key 不会在页面显示。如需更换，请在下方输入新的 Key；留空则保留当前密钥。"
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      <Alert
        message="AI设置说明"
        description="配置AI大模型接口后，系统可以使用AI出题、智能分析等功能。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Form form={settingsForm} layout="vertical" onFinish={handleSave}>
        <Form.Item name="ai_model" label="大模型名称" rules={[{ required: true, message: '请输入模型名称' }]}>
          <Input placeholder="如 gpt-3.5-turbo" />
        </Form.Item>
        <Form.Item name="ai_base_url" label="API Base URL" rules={[{ required: true, message: '请输入API地址' }]}>
          <Input placeholder="如 https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item name="ai_api_key" label="API Key" extra="留空则保留当前密钥，录入新值将替换">
          <Input.Password placeholder="留空保留当前设置，或输入新 API 密钥" />
        </Form.Item>
        <Form.Item name="ai_vision_model" label="视觉模型（可选，用于识别纸质作业照片）" extra="留空则使用上面的大模型。识别手写作业照片需要支持图片输入的模型（如 qwen-vl、gpt-4o 等），且服务接口需兼容 OpenAI 图片格式。">
          <Input placeholder="如 qwen-vl-plus，留空使用上方大模型" />
        </Form.Item>

        <Divider orientation="left" style={{ margin: '24px 0 16px' }}>接口协议与思考模式</Divider>
        <Form.Item
          name="ai_api_mode"
          label="接口协议"
          extra="Chat Completions 是绝大多数兼容服务的通用选择；只有当服务商明确提供 /responses 接口时才需要切换。"
        >
          <Select
            options={[
              { value: 'chat', label: 'Chat Completions（默认，兼容性最好）' },
              { value: 'responses', label: 'Responses（推理类模型推荐）' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="ai_thinking_enabled"
          label="思考模式（推理模型）"
          valuePropName="checked"
          extra="开启后模型会先推理再作答，复杂题目（如作文、判分）质量更好，但响应更慢、消耗更多 tokens。出题等要求严格 JSON 输出的场景建议关闭。不支持时会自动降级，不影响正常使用。"
        >
          <Switch checkedChildren="已开启" unCheckedChildren="已关闭" />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev: any, cur: any) => prev.ai_thinking_enabled !== cur.ai_thinking_enabled}>
          {({ getFieldValue }: any) => (
            <div style={{ marginBottom: 16, paddingLeft: 8, borderLeft: '2px solid #f0f0f0' }}>
              {getFieldValue('ai_thinking_enabled') ? (
                <>
                  <Form.Item name="ai_thinking_effort" label="思考强度" extra="越高越严谨，耗时与费用也越高。">
                    <Select
                      options={[
                        { value: 'low', label: '低（快、省 token）' },
                        { value: 'medium', label: '中（推荐）' },
                        { value: 'high', label: '高（慢、质量优先）' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="ai_thinking_budget" label="思考预算 Tokens（可选）" extra="限制推理阶段可消耗的最大 token 数，0 表示不限制，由模型自行决定。部分兼容服务需要此参数。">
                    <Input type="number" min={0} max={200000} placeholder="0" />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(p: any, c: any) => p.ai_api_mode !== c.ai_api_mode}>
                    {({ getFieldValue: get2 }: any) => get2('ai_api_mode') === 'responses' ? (
                      <Form.Item name="ai_thinking_summary" label="推理摘要" extra="让模型额外返回一段推理摘要，便于排查模型是否正常思考。">
                        <Select
                          allowClear
                          options={[
                            { value: 'auto', label: '自动' },
                            { value: 'concise', label: '简要' },
                            { value: 'detailed', label: '详细' },
                          ]}
                        />
                      </Form.Item>
                    ) : null}
                  </Form.Item>
                </>
              ) : null}
            </div>
          )}
        </Form.Item>

        <Divider orientation="left" style={{ margin: '24px 0 16px' }}>调用与报告设置</Divider>
        <Form.Item name="ai_report_interval_days" label="AI报告重新生成间隔（天）" rules={[{ required: true, message: '请输入间隔天数' }]} extra="学生生成学习规划或诊断报告后，需间隔多少天才可重新生成。默认3天。">
          <Input type="number" min={1} max={30} placeholder="3" />
        </Form.Item>
        <Form.Item name="ai_timeout" label="大模型请求超时（秒）" rules={[{ required: true, message: '请输入超时时间' }]} extra="AI请求的最大等待时间，超时将返回错误。默认300秒（5分钟）。">
          <Input type="number" min={10} max={600} placeholder="300" />
        </Form.Item>

        <Divider orientation="left" style={{ margin: '24px 0 16px' }}>生成限制设置</Divider>
        <Form.Item name="max_tokens_per_generation" label="单次生成最大Tokens" rules={[{ required: true, message: '请输入最大tokens' }]} extra="每次AI生成作业时，返回的最大tokens数量。默认18000。">
          <Input type="number" min={1000} max={100000} placeholder="18000" />
        </Form.Item>
        <Form.Item name="daily_teacher_gen_limit" label="每位教师每日生成次数上限" rules={[{ required: true, message: '请输入次数' }]} extra="每个教师账号每天最多生成作业的次数，次日0点重置。默认20次。AI 出题失败（返回格式错误、超时、未能生成有效题目）不计入次数。">
          <Input type="number" min={1} max={100} placeholder="20" />
        </Form.Item>
        <Form.Item name="ai_gen_max_rounds" label="AI 出题最大轮次" rules={[{ required: true, message: '请输入轮次' }]} extra="单次出题内部最多向大模型请求几轮。题量偏多导致输出被截断时会分多轮续写补齐，解析失败会自动重试。默认3轮。">
          <Input type="number" min={1} max={5} placeholder="3" />
        </Form.Item>
        <Form.Item name="daily_global_token_limit" label="全站每日Token消耗上限" rules={[{ required: true, message: '请输入上限' }]} extra="整个网站每天最多消耗的生成tokens数量（仅计算completion tokens），超限后禁止生成。默认2,000,000。">
          <Input type="number" min={10000} max={100000000} placeholder="2000000" />
        </Form.Item>
        <Form.Item name="max_questions_per_generation" label="单次生成最大题目数" rules={[{ required: true, message: '请输入题目数' }]} extra="服务端限制每次生成作业的最大题目数量（含变体×3），防止恶意请求。默认20道。">
          <Input type="number" min={1} max={50} placeholder="20" />
        </Form.Item>
        <Form.Item name="ai_gen_concurrency" label="多题型并发数" extra="一次配置多种题型时，同时向大模型发起几个请求。串行会累加到几百秒（易撞网关超时），并发能大幅缩短总耗时。调高可能触发服务商限流，默认3，建议 3~5。">
          <Input type="number" min={1} max={8} placeholder="3" />
        </Form.Item>

        {testResult && (
          <Alert
            message={testResult.message}
            description={
              testResult.success ? (
                <div>
                  <div>AI 回复：{testResult.ai_reply}</div>
                  <div style={{ marginTop: 4 }}>耗时：{testResult.elapsed}</div>
                  {testResult.detail && (
                    <div style={{ marginTop: 4, color: '#fa8c16' }}>{testResult.detail}</div>
                  )}
                </div>
              ) : (
                <div>
                  <div>{testResult.detail}</div>
                </div>
              )
            }
            type={testResult.success ? 'success' : 'error'}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>保存设置</Button>
            <Button onClick={handleTest} loading={testing} icon={<ThunderboltOutlined />}>
              {testing ? '测试中...' : '测试连接'}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
    <PromptSettings />
    </div>
  );
};

export { AISettings };
export default AISettings;
