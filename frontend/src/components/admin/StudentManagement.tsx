import React, { useEffect, useState, useMemo } from 'react';
import { Table, Button, Tabs, Form, Input, message, Tag, Space, Modal, Select, InputNumber, Popconfirm, List, Descriptions, Alert, Divider, Dropdown, Progress } from 'antd';
import { DeleteOutlined, EditOutlined, SafetyOutlined, UploadOutlined, DownloadOutlined, FileExcelOutlined, FileTextOutlined } from '@ant-design/icons';
import { adminAPI } from '../../utils/api';
import { pollAiTask } from '../../utils/aiTask';
import { useAuthStore } from '../../store/authStore';
import { useMobile, useTablePagination } from './hooks';
import { parseCsvText, normalizeStudentRows, downloadExcelTemplate, ExportFormat, exportTableFile } from './_common';

const StudentManagement: React.FC = () => {
  const pagination = useTablePagination();
  const isMobile = useMobile();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [classFilter, setClassFilter] = useState<number | undefined>();
  const [searchText, setSearchText] = useState('');
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [goldModalVisible, setGoldModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [studentDetail, setStudentDetail] = useState<any>(null);
  const [form] = Form.useForm();
  const [goldForm] = Form.useForm();
  const [importForm] = Form.useForm();
  // 粘贴名单导入
  const [importMode, setImportMode] = useState<'paste' | 'file'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [pastePrefix, setPastePrefix] = useState('stu');
  const [generating, setGenerating] = useState(false);
  // AI 生成账号进度（后端后台执行，这里轮询刷新）
  const [genProgress, setGenProgress] = useState<{ percent: number; done: number; total: number; current: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [generatedAccounts, setGeneratedAccounts] = useState<any[] | null>(null);
  const [pasteWarnings, setPasteWarnings] = useState<any>(null);
  const [aiFallbackMsg, setAiFallbackMsg] = useState<string | null>(null);

  useEffect(() => {
    loadClasses();
    loadStudents();
  }, [statusFilter, classFilter, searchText]);

  const loadClasses = async () => {
    try {
      const res = await adminAPI.getClasses();
      setClasses(res.data.classes || []);
    } catch (error) {
      console.error('加载班级失败');
    }
  };

  const loadStudents = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getStudents({ status: statusFilter || undefined, class_id: classFilter, search: searchText || undefined });
      setStudents(res.data.students || []);
    } catch (error) {
      message.error('加载学生列表失败');
    } finally {
      setLoading(false);
    }
  };

  const getManageableClasses = () => {
    if (isAdmin) return classes;
    // teacher_classes 里班级的自增主键字段名是 id（见 auth.js 的 teacher_classes 查询），
        // 不是 class_id —— 用错会导致过滤失效、可管理班级列表恒为空。
        // 统一转成 number 再比较，与 utils/permissions.ts 的做法保持一致。
        const myClassIds = (user as any)?.teacher_classes
          ?.filter((c: any) => c.class_role === 'head_teacher')
          .map((c: any) => Number(c.id)) || [];
        return classes.filter((c: any) => myClassIds.includes(Number(c.id)));
  };

  const handleDownloadTemplate = async (format: 'json' | 'csv' | 'xlsx') => {
    try {
      if (format === 'xlsx') {
        await downloadExcelTemplate();
        message.success('Excel 模板下载成功（用 Excel 打开填好后，可直接上传 .xlsx 文件）');
        return;
      }

      const res = await adminAPI.getImportTemplate(format);
      const isCsv = format === 'csv';
      const content = isCsv ? res.data : JSON.stringify(res.data.template, null, 2);
      const blob = new Blob([content], { type: isCsv ? 'text/csv;charset=utf-8;' : 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = isCsv ? '学生导入模板.csv' : '学生导入模板.json';
      link.click();
      URL.revokeObjectURL(link.href);
      message.success(isCsv ? 'CSV 模板下载成功（可直接用 Excel 打开编辑）' : 'JSON 模板下载成功');
    } catch (error: any) {
      message.error(`下载模板失败：${error?.response?.data?.error || error?.message || '请检查网络或登录状态'}`);
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      let rows: any[] = [];

      if (ext === 'xlsx' || ext === 'xls') {
        // Excel：用 SheetJS 解析第一个工作表
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      } else if (ext === 'csv') {
        rows = parseCsvText(await file.text());
      } else if (ext === 'json') {
        rows = JSON.parse(await file.text());
      } else {
        throw new Error('不支持的文件格式，请使用 .xlsx / .xls / .csv / .json');
      }

      const students = normalizeStudentRows(Array.isArray(rows) ? rows : []);
      if (students.length === 0) {
        throw new Error('没有解析到有效的学生数据（请确认表头包含：用户名、密码，或 username、password）');
      }

      importForm.setFieldValue('students', JSON.stringify(students, null, 2));
      message.success(`成功解析 ${students.length} 个学生，确认无误后点「确定」导入`);
    } catch (error: any) {
      message.error(`解析文件失败：${error?.message || '请检查文件格式'}`);
    }
    return false;
  };

  const handleImport = async () => {
    try {
      const values = await importForm.validateFields();
      const classId = values.class_id;
      let students;
      try {
        students = JSON.parse(values.students);
      } catch {
        throw new Error('学生数据格式错误');
      }
      
      if (!Array.isArray(students) || students.length === 0) {
        throw new Error('请至少添加一个学生');
      }

      const res = await adminAPI.importStudents(classId, students);
      // 后端返回 { message, results: { success: [], failed: [], skipped: [] } }
      const r = res.data?.results || {};
      message.success(
        res.data?.message ||
        `导入完成：成功 ${r.success?.length ?? 0} 个，失败 ${r.failed?.length ?? 0} 个，跳过 ${r.skipped?.length ?? 0} 个`
      );
      setImportModalVisible(false);
      loadStudents();
    } catch (error: any) {
      message.error(error.response?.data?.error || error.message || '导入失败');
    }
  };

  // ==================== 粘贴名单 → 生成账号 ====================

  // 实时预估：清洗规则与后端保持一致（去空行、去首尾空格、去行首序号、超长行忽略）
  const pastePreview = useMemo(() => {
    const lines = pasteText.split(/\r?\n/);
    const toHalf = (s: string) => s.replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    let empty = 0;
    let invalid = 0;
    const names: string[] = [];
    for (const line of lines) {
      let s = toHalf(line).replace(/\u3000/g, ' ').trim();
      if (!s) { empty += 1; continue; }
      s = s.replace(/^[(\[（【]?\d+[)\]）】]?\s*[.、,，:：-]?\s*/, '').trim();
      const parts = s.split(/[,，;；\t]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 2) s = parts[1];
      else if (parts.length > 2) {
        const noDigit = parts.filter((p) => !/\d/.test(p));
        s = noDigit.length ? noDigit[noDigit.length - 1] : parts[parts.length - 1];
      }
      s = s.replace(/^["'“”‘’【】\[\]()（）\s]+|["'“”‘’【】\[\]()（）\s]+$/g, '').trim();
      if (!s) { empty += 1; continue; }
      if (s.length > 20) { invalid += 1; continue; }
      names.push(s);
    }
    const counter = new Map<string, number>();
    names.forEach((n) => counter.set(n, (counter.get(n) || 0) + 1));
    const duplicates = Array.from(counter.entries()).filter(([, c]) => c > 1).map(([n]) => n);
    return { lines: lines.length, empty, invalid, names, duplicates };
  }, [pasteText]);

  const handleGenerateAccounts = async (mode: 'ai' | 'sequence') => {
    const classId = importForm.getFieldValue('class_id');
    if (!classId) { message.warning('请先选择班级'); return; }
    if (!pasteText.trim()) { message.warning('请先粘贴学生姓名'); return; }
    setGenerating(true);
    setAiFallbackMsg(null);
    setGenProgress({ percent: 0, done: 0, total: 1, current: '正在提交生成任务' });
    try {
      const res = await adminAPI.generateStudentAccounts({ names: pasteText, mode, prefix: pastePrefix, class_id: classId });
      // AI 模式已改为后台任务：提交只返回 task_id，生成过程靠轮询拿进度。
      // 按序号生成本身是纯本地计算，接口会直接返回结果而没有 task_id。
      const data = res.data?.task_id
        ? await pollAiTask(res.data.task_id, '/admin/students/task/:taskId', setGenProgress)
        : res.data;
      setGenProgress(null);

      setGeneratedAccounts(data.accounts || []);
      setPasteWarnings({
        duplicates: data.duplicate_names || [],
        aiMissing: data.ai_fallback_names || []
      });
      message.success(data.message || `已生成 ${data.count} 个账号`);
    } catch (error: any) {
      const d = error?.response?.data;
      if (d?.can_fallback) {
        setAiFallbackMsg(d.error || 'AI 生成账号失败');
      } else {
        message.error(d?.error || error?.message || '生成账号失败');
      }
    } finally {
      setGenProgress(null);
      setGenerating(false);
    }
  };

  const updateAccount = (idx: number, field: 'username' | 'password', value: string) => {
    setGeneratedAccounts((prev) => (prev || []).map((a, i) => (i === idx ? { ...a, [field]: value } : a)));
  };

  const handlePasteImport = async () => {
    const classId = importForm.getFieldValue('class_id');
    if (!classId) { message.warning('请先选择班级'); return; }
    const list = (generatedAccounts || []).filter((a) => a.username && a.password);
    if (list.length === 0) { message.warning('请先生成账号'); return; }
    const bad = list.find((a) => !/^[a-zA-Z0-9_]{3,20}$/.test(String(a.username).trim()));
    if (bad) { message.error(`账号「${bad.username}」格式不合法（3-20 位字母、数字或下划线）`); return; }

    setImporting(true);
    try {
      const res = await adminAPI.importStudents(classId, list.map((a) => ({
        username: String(a.username).trim(),
        password: a.password,
        real_name: a.real_name
      })));
      const r = res.data?.results || {};
      message.success(res.data?.message || `导入完成：成功 ${r.success?.length ?? 0} 个`);
      const problems = [...(r.failed || []), ...(r.skipped || [])];
      if (problems.length > 0) {
        Modal.warning({
          title: '部分学生未导入',
          width: 520,
          content: (
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {problems.map((p: any, i: number) => (
                <div key={i}>{p.real_name || p.username}：{p.error}</div>
              ))}
            </div>
          )
        });
      }
      loadStudents();
    } catch (error: any) {
      message.error(error?.response?.data?.error || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const closeImportModal = () => {
    setImportModalVisible(false);
    importForm.resetFields();
    setGeneratedAccounts(null);
    setPasteText('');
    setPasteWarnings(null);
    setAiFallbackMsg(null);
  };

  // 导出格式下拉菜单（CSV / TXT / Excel），withResetPassword 时额外提供「导出并重置密码」
  const exportFormatMenu = (onSelect: (key: string) => void, withResetPassword = false) => ({
    items: [
      { key: 'xlsx', icon: <FileExcelOutlined />, label: 'Excel 表格（.xlsx）' },
      { key: 'csv', icon: <FileTextOutlined />, label: 'CSV 文件（.csv）' },
      { key: 'txt', icon: <FileTextOutlined />, label: 'TXT 文本（.txt）' },
      ...(withResetPassword ? [
        { type: 'divider' as const },
        { key: 'xlsx-reset', icon: <SafetyOutlined />, label: '导出并重置密码（.xlsx）', danger: true },
      ] : []),
    ],
    onClick: ({ key }: { key: string }) => onSelect(key),
  });

  // 导出当前筛选出来的学生列表（支持 Excel / CSV / TXT）
  // withPassword = true 时先为这些学生重置密码，并把明文新密码写入「密码」列
  const handleExportStudents = async (format: ExportFormat, withPassword = false) => {
    const list = students || [];
    if (list.length === 0) { message.warning('当前没有可导出的学生'); return; }
    const statusMap: Record<string, string> = { active: '已激活', disabled: '已禁用' };

    // 系统只保存密码哈希，无法还原原密码；需要明文时先批量重置为新密码
    const passwordMap: Record<number, string> = {};
    if (withPassword) {
      const hide = message.loading('正在重置密码...', 0);
      try {
        const res = await adminAPI.resetStudentPasswords({ student_ids: list.map((s: any) => s.id) });
        (res.data?.results || []).forEach((r: any) => { passwordMap[r.id] = r.password; });
      } catch (error: any) {
        hide();
        message.error(`重置密码失败：${error?.response?.data?.error || error?.message || '请稍后重试'}`);
        return;
      }
      hide();
    }

    const headers = ['ID', '姓名', '用户名', '密码', '邮箱', '班级', '金币', '状态', '注册时间'];
    const rows = list.map((s: any) => [
      s.id,
      s.real_name || '',
      s.username || '',
      withPassword ? (passwordMap[s.id] || '') : '已加密',
      s.email || '',
      s.class_name || '未分配',
      s.gold ?? '',
      statusMap[s.status] || s.status || '',
      s.created_at ? new Date(s.created_at).toLocaleString() : '',
    ]);
    const clsName = classFilter ? classes.find((c: any) => c.id === classFilter)?.name : '';
    // 文件名带上当前的筛选条件，便于区分
    const nameParts = ['学生数据'];
    if (clsName) nameParts.push(clsName);
    if (statusFilter) nameParts.push(statusMap[statusFilter] || statusFilter);
    if (searchText) nameParts.push(searchText);
    if (withPassword) nameParts.push('含新密码');
    try {
      await exportTableFile(headers, rows, format, nameParts.join('-'), '学生数据');
      message.success(withPassword
        ? `已导出 ${list.length} 名学生，密码已重置为文件中的新密码`
        : `已导出 ${list.length} 条学生数据`);
    } catch (error: any) {
      message.error(`导出失败：${error?.message || '请稍后重试'}`);
    }
  };

  // 导出菜单分发：「导出并重置密码」属于危险操作，先二次确认
  const handleExportStudentsMenu = (key: string) => {
    if (key === 'xlsx-reset') {
      const count = (students || []).length;
      Modal.confirm({
        title: '导出并重置密码',
        content: `将为当前筛选出的 ${count} 名学生生成新的随机 6 位密码并立即生效，原密码作废。导出后请及时把新密码发给学生。是否继续？`,
        okText: '确定重置并导出',
        okButtonProps: { danger: true },
        onOk: () => handleExportStudents('xlsx', true),
      });
      return;
    }
    handleExportStudents(key as ExportFormat);
  };

  // 下载「姓名 + 账号 + 密码」名单（支持 Excel / CSV / TXT）
  const handleDownloadAccounts = async (format: ExportFormat) => {
    const list = (generatedAccounts || []).filter((a) => a.username);
    if (list.length === 0) { message.warning('还没有可下载的账号'); return; }
    const cls = getManageableClasses().find((c: any) => c.id === importForm.getFieldValue('class_id'));
    const headers = ['姓名', '登录账号', '密码'];
    const rows = list.map((a) => [a.real_name || '', a.username, a.password]);
    try {
      await exportTableFile(headers, rows, format, `${cls?.name || '学生'}账号密码名单`, '账号密码名单');
      message.success('名单已下载，可打印或发给学生');
    } catch (error: any) {
      message.error(`下载失败：${error?.message || '请稍后重试'}`);
    }
  };

  const viewDetail = async (id: number) => {
    setDetailModalVisible(true);
    setSelectedStudent(students.find(s => s.id === id));
    try {
      const res = await adminAPI.getStudentDetail(id);
      setStudentDetail(res.data);
    } catch (error) {
      message.error('加载学生详情失败');
    }
  };

  const handleEdit = (record: any) => {
    setSelectedStudent(record);
    // 每次都清空密码框，避免残留上一次输入
    form.setFieldsValue({ ...record, password: '' });
    setEditModalVisible(true);
  };

  const handleUpdate = async () => {
    try {
      const values = await form.validateFields();
      await adminAPI.updateStudent(selectedStudent.id, values);
      if (values.password) {
        message.success(`密码已重置为：${values.password}（请告知该学生）`, 8);
      } else {
        message.success('学生信息更新成功');
      }
      setEditModalVisible(false);
      loadStudents();
    } catch (error: any) {
      if (error?.response?.data?.error) {
        message.error(error.response.data.error);
      } else if (error?.errorFields) {
        // 表单校验未通过，antd 已就地提示
      } else {
        message.error('更新失败');
      }
    }
  };

  const handleGoldAdjust = async () => {
    try {
      const values = await goldForm.validateFields();
      await adminAPI.adjustStudentGold(selectedStudent.id, values.amount, values.reason);
      message.success('金币调整成功');
      setGoldModalVisible(false);
      goldForm.resetFields();
      loadStudents();
    } catch (error) {
      message.error('调整失败');
    }
  };

  const handleDelete = async (id: number, action: 'delete' | 'disable') => {
    try {
      await adminAPI.deleteStudent(id, action);
      message.success(action === 'delete' ? '学生已删除' : '学生已禁用');
      loadStudents();
    } catch (error: any) {
      message.error(error.response?.data?.error || '操作失败');
    }
  };

  const isHeadTeacherOfStudent = (record: any) => {
    if (isAdmin) return true;
    if (!user || user.role !== 'teacher') return false;
    const cls = classes.find((c: any) => c.id === record.class_id);
    if (!cls) return false;
    return cls.teachers?.some((t: any) => t.teacher_id === user.id && t.role === 'head_teacher');
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '姓名', dataIndex: 'real_name', key: 'real_name', render: (v: string) => v || <span style={{ color: '#bbb' }}>—</span> },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '班级', dataIndex: 'class_name', key: 'class_name', render: (v: string) => v || '未分配' },
    { title: '金币', dataIndex: 'gold', key: 'gold', render: (v: number) => <span style={{ color: '#faad14' }}>{v}</span> },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => new Date(v).toLocaleDateString() },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const map: any = { active: { color: 'green', text: '已激活' }, disabled: { color: 'red', text: '已禁用' } };
        const s = map[status] || { color: 'default', text: status };
        return <Tag color={s.color}>{s.text}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => {
        const canManage = isHeadTeacherOfStudent(record);
        return (
          <Space>
            <Button type="link" onClick={() => viewDetail(record.id)}>详情</Button>
            {canManage && (
              <>
                <Button type="link" onClick={() => { setSelectedStudent(record); goldForm.setFieldsValue({ amount: 0 }); setGoldModalVisible(true); }}>调金币</Button>
                <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
                {record.status !== 'disabled' && (
                  <Button type="link" danger onClick={() => handleDelete(record.id, 'disable')}>禁用</Button>
                )}
                <Popconfirm title="确定删除该学生？（包括其所有宠物和物品）" onConfirm={() => handleDelete(record.id, 'delete')}>
                  <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              </>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search placeholder="搜索学生" onSearch={setSearchText} style={{ width: 200 }} allowClear />
          <Select placeholder="筛选班级" style={{ width: 150 }} allowClear value={classFilter} onChange={setClassFilter}>
            {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
          </Select>
          <Select placeholder="筛选状态" style={{ width: 120 }} allowClear value={statusFilter || undefined} onChange={setStatusFilter}>
            <Select.Option value="active">已激活</Select.Option>
            <Select.Option value="disabled">已禁用</Select.Option>
          </Select>
          <Button onClick={loadStudents}>刷新</Button>
          {(isAdmin || (user?.role === 'teacher' && (user as any)?.teacher_classes?.some((c: any) => c.class_role === 'head_teacher'))) && (
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setImportModalVisible(true)}>导入学生</Button>
          )}
          <Dropdown.Button
            menu={exportFormatMenu(handleExportStudentsMenu, true)}
            onClick={() => handleExportStudents('xlsx')}
            disabled={students.length === 0}
          >
            <FileExcelOutlined /> 导出学生数据
          </Dropdown.Button>
        </Space>
      </div>
      <Table columns={columns} dataSource={students} rowKey="id" loading={loading} pagination={pagination} scroll={{ x: true }} />

      <Modal title="学生详情" open={detailModalVisible} onCancel={() => setDetailModalVisible(false)} footer={null} width={isMobile ? '95vw' : 800}>
        {studentDetail && (
          <div>
            <Descriptions bordered column={2}>
              <Descriptions.Item label="姓名">{studentDetail.student.real_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="用户名">{studentDetail.student.username}</Descriptions.Item>
              <Descriptions.Item label="邮箱">{studentDetail.student.email}</Descriptions.Item>
              <Descriptions.Item label="班级">{studentDetail.student.class_name || '未分配'}</Descriptions.Item>
              <Descriptions.Item label="金币"><span style={{ color: '#faad14' }}>{studentDetail.student.gold}</span></Descriptions.Item>
              <Descriptions.Item label="状态">{studentDetail.student.status}</Descriptions.Item>
              <Descriptions.Item label="注册时间">{new Date(studentDetail.student.created_at).toLocaleDateString()}</Descriptions.Item>
            </Descriptions>
            <h4 style={{ marginTop: 16 }}>宠物 ({studentDetail.pets?.length || 0})</h4>
            <List size="small" dataSource={studentDetail.pets || []} renderItem={(pet: any) => (
              <List.Item>
                <Space>
                  <span>{pet.name}</span>
                  <Tag>等级 {pet.level}</Tag>
                  <Tag color="blue">经验 {pet.exp}</Tag>
                </Space>
              </List.Item>
            )} />
            <h4 style={{ marginTop: 16 }}>物品 ({studentDetail.items?.length || 0})</h4>
            <List size="small" dataSource={studentDetail.items || []} renderItem={(item: any) => (
              <List.Item>
                <Space>
                  <span>{item.name}</span>
                  <Tag>x{item.quantity}</Tag>
                </Space>
              </List.Item>
            )} />
            <h4 style={{ marginTop: 16 }}>装备 ({studentDetail.equipment?.length || 0})</h4>
            <List size="small" dataSource={studentDetail.equipment || []} renderItem={(eq: any) => (
              <List.Item>
                <Space>
                  <span>{eq.name}</span>
                  <Tag color={eq.rarity === 'rare' ? 'purple' : eq.rarity === 'epic' ? 'red' : 'blue'}>{eq.rarity}</Tag>
                  <Tag>等级 {eq.level}</Tag>
                </Space>
              </List.Item>
            )} />
          </div>
        )}
      </Modal>

      <Modal title="编辑学生" open={editModalVisible} onOk={handleUpdate} onCancel={() => setEditModalVisible(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="real_name" label="姓名"><Input placeholder="学生姓名" /></Form.Item>
          <Form.Item name="username" label="用户名（登录账号）"><Input /></Form.Item>
          <Form.Item
            name="password"
            label="重置密码"
            extra="留空表示不修改；填写并保存后立即生效，学生下次登录请使用新密码"
            rules={[{ validator: (_, v) => (!v || String(v).length >= 6) ? Promise.resolve() : Promise.reject(new Error('密码至少 6 位')) }]}
          >
            <Input.Password
              placeholder="至少 6 位，留空不修改"
              autoComplete="new-password"
              addonAfter={<a onClick={() => form.setFieldValue('password', String(Math.floor(100000 + Math.random() * 900000)))}>随机生成</a>}
            />
          </Form.Item>
          <Form.Item name="email" label="邮箱"><Input /></Form.Item>
          <Form.Item name="class_id" label="班级">
            <Select allowClear onChange={v => form.setFieldValue('class_id', v)}>
              {classes.map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select>
              <Select.Option value="active">已激活</Select.Option>
              <Select.Option value="disabled">已禁用</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="调整金币" open={goldModalVisible} onOk={handleGoldAdjust} onCancel={() => setGoldModalVisible(false)}>
        <Form form={goldForm} layout="vertical">
          <Form.Item name="amount" label="金币调整量（正数增加，负数减少）" rules={[{ required: true, message: '请输入调整量' }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="原因（可选）"><Input.TextArea /></Form.Item>
        </Form>
      </Modal>

      <Modal 
        title="批量导入学生" 
        open={importModalVisible} 
        onCancel={closeImportModal}
        width={isMobile ? '95vw' : 780}
        footer={[
          <Button key="cancel" onClick={closeImportModal}>取消</Button>,
          importMode === 'paste' && generatedAccounts ? (
            <span key="download">
              <Dropdown menu={exportFormatMenu((key) => handleDownloadAccounts(key as ExportFormat))} trigger={['click']}>
                <Button icon={<DownloadOutlined />}>下载名单</Button>
              </Dropdown>
            </span>
          ) : null,
          importMode === 'paste' ? (
            <Button
              key="pasteOk"
              type="primary"
              loading={generating || importing}
              onClick={() => (generatedAccounts ? handlePasteImport() : handleGenerateAccounts('ai'))}
            >
              {generatedAccounts ? `确认导入（${generatedAccounts.length} 人）` : 'AI 生成账号'}
            </Button>
          ) : (
            <Button key="fileOk" type="primary" onClick={handleImport}>确定导入</Button>
          )
        ]}
      >
        {/* 生成进度：200 个账号要跑十几批 AI，让管理员看得见进度而不是干等 */}
        {generating && genProgress && (
          <Alert
            style={{ marginBottom: 12 }}
            type="info"
            showIcon
            message={
              <div>
                <Progress percent={genProgress.percent} size="small" status="active" />
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  {genProgress.current}
                  {genProgress.total > 1 && `（${genProgress.done}/${genProgress.total} 批）`}
                </div>
              </div>
            }
          />
        )}
        <Form form={importForm} layout="vertical">
          <Form.Item 
            name="class_id" 
            label="选择班级" 
            rules={[{ required: true, message: '请选择班级' }]}
          >
            <Select
              placeholder="请选择班级"
              onChange={() => { setGeneratedAccounts(null); setPasteWarnings(null); setAiFallbackMsg(null); }}
            >
              {getManageableClasses().map(c => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
            </Select>
          </Form.Item>

          <Tabs
            activeKey={importMode}
            onChange={(k) => setImportMode(k as 'paste' | 'file')}
            items={[
              {
                key: 'paste',
                label: '粘贴姓名生成账号（推荐）',
                children: (
                  <div>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="只需粘贴学生姓名，一行一个"
                      description="系统会自动去掉空行、前后空格和行首序号，再由 AI 生成登录账号（拼音）+ 随机 6 位数字密码。登录账号与姓名可以不一样。"
                    />

                    <Input.TextArea
                      rows={8}
                      value={pasteText}
                      onChange={(e) => {
                        setPasteText(e.target.value);
                        setGeneratedAccounts(null);
                        setPasteWarnings(null);
                        setAiFallbackMsg(null);
                      }}
                      placeholder={'张三\n李四\n王五\n\n也支持带序号的名单：1. 张三 / 2、李四 / 20250101,钱七'}
                    />

                    <div style={{ margin: '8px 0', color: '#666', fontSize: 13 }}>
                      已粘贴 {pastePreview.lines} 行 → 有效 <b>{pastePreview.names.length}</b> 人
                      {pastePreview.empty > 0 && `，忽略空行 ${pastePreview.empty} 行`}
                      {pastePreview.invalid > 0 && `，忽略疑似非姓名 ${pastePreview.invalid} 行`}
                      {pastePreview.duplicates.length > 0 && (
                        <span style={{ color: '#fa8c16' }}>，重名 {pastePreview.duplicates.length} 个</span>
                      )}
                    </div>

                    {pastePreview.duplicates.length > 0 && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message={`检测到重名：${pastePreview.duplicates.slice(0, 10).join('、')}`}
                        description="同名学生真实存在时会各自生成账号；如果是重复粘贴，请删掉多余的那行再生成。"
                      />
                    )}

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                      <span style={{ color: '#666', fontSize: 13 }}>序号模式账号前缀：</span>
                      <Input
                        value={pastePrefix}
                        onChange={(e) => setPastePrefix(e.target.value)}
                        style={{ width: 110 }}
                        placeholder="stu"
                      />
                      <Button onClick={() => handleGenerateAccounts('sequence')} loading={generating}>按序号生成账号</Button>
                      <span style={{ color: '#999', fontSize: 12 }}>（AI 不可用时用：生成 stu001、stu002…）</span>
                    </div>

                    {aiFallbackMsg && (
                      <Alert
                        type="error"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message="AI 生成账号不可用"
                        description={
                          <div>
                            <div>{aiFallbackMsg}</div>
                            <Button
                              type="primary"
                              size="small"
                              style={{ marginTop: 8 }}
                              onClick={() => handleGenerateAccounts('sequence')}
                            >
                              改用「按序号生成账号」
                            </Button>
                            <span style={{ marginLeft: 8, color: '#888' }}>生成后可在下方逐条修改账号</span>
                          </div>
                        }
                      />
                    )}

                    {generatedAccounts && (
                      <div>
                        <Divider orientation="left">生成结果（{generatedAccounts.length} 人，可直接修改账号/密码）</Divider>
                        {(pasteWarnings?.aiMissing?.length || 0) > 0 && (
                          <Alert
                            type="warning"
                            showIcon
                            style={{ marginBottom: 8 }}
                            message={`有 ${pasteWarnings.aiMissing.length} 个姓名 AI 未返回账号，已用序号兜底（可在下方手动修改）`}
                          />
                        )}
                        <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
                          <Table
                            size="small"
                            pagination={false}
                            rowKey={(_: any, idx?: number) => String(idx)}
                            dataSource={generatedAccounts}
                            columns={[
                              { title: '姓名', dataIndex: 'real_name', width: 90 },
                              {
                                title: '登录账号',
                                dataIndex: 'username',
                                render: (v: string, _r: any, idx: number) => (
                                  <Input size="small" value={v} onChange={(e) => updateAccount(idx, 'username', e.target.value)} />
                                )
                              },
                              {
                                title: '密码',
                                dataIndex: 'password',
                                width: 140,
                                render: (v: string, _r: any, idx: number) => (
                                  <Input size="small" value={v} onChange={(e) => updateAccount(idx, 'password', e.target.value)} />
                                )
                              }
                            ]}
                          />
                        </div>
                        <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
                          确认无误后点右下角「确认导入（{generatedAccounts.length} 人）」写入系统；导入后可用「下载名单」把账号密码发给学生。
                        </div>
                      </div>
                    )}
                  </div>
                )
              },
              {
                key: 'file',
                label: '文件 / 表格导入',
                children: (
                  <div>
                    <div style={{ marginBottom: 16 }}>
                      <Divider orientation="left">下载模板</Divider>
                      <Space wrap>
                        <Button type="primary" ghost icon={<FileExcelOutlined />} onClick={() => handleDownloadTemplate('xlsx')}>
                          Excel 模板（推荐）
                        </Button>
                        <Button icon={<DownloadOutlined />} onClick={() => handleDownloadTemplate('csv')}>CSV 模板</Button>
                        <Button icon={<DownloadOutlined />} onClick={() => handleDownloadTemplate('json')}>JSON 模板</Button>
                      </Space>
                      <div style={{ color: '#888', fontSize: 12, marginTop: 8, lineHeight: 1.9 }}>
                        · <b>Excel 模板（.xlsx）</b>：用 Excel / WPS 打开填好，保存后直接上传这个文件即可；<br />
                        · <b>CSV 模板</b>：其实就是"表格文件"，Excel 也能直接打开编辑，改完另存为 CSV 再上传；<br />
                        · 表头支持中文（用户名、密码、邮箱、姓名）或英文（username、password、email、real_name），邮箱和姓名可以留空。
                      </div>
                    </div>

                    <Form.Item 
                      name="students" 
                      label="学生数据" 
                      rules={[{ required: true, message: '请输入学生数据' }]}
                      extra="可以直接在下面编辑数据（JSON 格式），也可以在上面下载模板、填好后上传 Excel / CSV / JSON 文件"
                    >
                      <Input.TextArea 
                        rows={10} 
                        placeholder='[{"username": "student1", "password": "111111", "email": "student1@example.com", "real_name": "张三"}]'
                      />
                    </Form.Item>

                    <div style={{ marginBottom: 16 }}>
                      <Divider orientation="left">或上传文件（Excel / CSV / JSON）</Divider>
                      <input 
                        type="file" 
                        accept=".xlsx,.xls,.csv,.json" 
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f);
                          e.target.value = '';
                        }}
                      />
                    </div>
                  </div>
                )
              }
            ]}
          />
        </Form>
      </Modal>
    </div>
  );
};

export { StudentManagement };
export default StudentManagement;
