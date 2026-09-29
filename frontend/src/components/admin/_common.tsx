

export interface PromptItem {
  key: string;
  group: string;
  label: string;
  description: string;
  value: string;
  is_custom: boolean;
  has_custom: boolean;
}

export const STUDENT_HEADER_MAP: Record<string, string> = {
  username: 'username', '用户名': 'username', '账号': 'username', '学号': 'username', '登录名': 'username',
  password: 'password', '密码': 'password',
  email: 'email', '邮箱': 'email', '电子邮箱': 'email',
  real_name: 'real_name', '姓名': 'real_name', '真实姓名': 'real_name', '名字': 'real_name', '学生姓名': 'real_name',
};

// 解析 CSV 文本（支持引号包裹、字段内逗号、BOM、\r\n）

export function parseCsvText(text: string): Record<string, string>[] {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((h) => String(h).trim());
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = String(r[i] ?? '').trim(); });
    return obj;
  });
}

// 把各种来源的行数据统一成后端需要的字段（username / password / email / real_name）

export function normalizeStudentRows(rows: any[]): any[] {
  return (rows || [])
    .map((row) => {
      const out: any = {};
      Object.keys(row || {}).forEach((key) => {
        const k = String(key).trim();
        const mapped = STUDENT_HEADER_MAP[k.toLowerCase()] || STUDENT_HEADER_MAP[k];
        if (mapped) out[mapped] = typeof row[key] === 'string' ? row[key].trim() : row[key];
      });
      return out;
    })
    .filter((s) => s.username || s.password || s.real_name);
}

// 生成并下载 Excel(.xlsx) 学生导入模板

export async function downloadExcelTemplate() {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.json_to_sheet(
    [
      { '用户名': 'student1', '密码': '111111', '邮箱': 'student1@example.com', '姓名': '张三' },
      { '用户名': 'student2', '密码': '111111', '邮箱': 'student2@example.com', '姓名': '李四' },
    ],
    { header: ['用户名', '密码', '邮箱', '姓名'] }
  );
  worksheet['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 12 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '学生名单');
  XLSX.writeFile(workbook, '学生导入模板.xlsx');
}

// ==================== 通用表格导出（CSV / TXT / XLSX）====================

export type ExportFormat = 'csv' | 'txt' | 'xlsx';

export function cellText(value: any): string {
  return value === null || value === undefined ? '' : String(value);
}

// 把「表头 + 数据行」导出为 CSV / TXT / Excel(.xlsx) 并触发浏览器下载

export async function exportTableFile(
  headers: string[],
  rows: any[][],
  format: ExportFormat,
  baseName: string,
  sheetName = '数据'
): Promise<void> {
  if (format === 'xlsx') {
    const XLSX = await import('xlsx');
    const aoa: any[][] = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet['!cols'] = headers.map((_: string, i: number) => {
      let maxLen = headers[i].length + 2;
      aoa.forEach((r) => { maxLen = Math.max(maxLen, cellText(r[i]).length + 2); });
      return { wch: Math.min(40, Math.max(10, maxLen)) };
    });
    const safeSheetName = (sheetName || '数据').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || '数据';
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
    XLSX.writeFile(workbook, `${baseName}.xlsx`);
    return;
  }

  const isCsv = format === 'csv';
  const delimiter = isCsv ? ',' : '\t';
  const escapeCell = (value: any): string => {
    const s = cellText(value);
    if (!isCsv) return s.replace(/[\t\r\n]+/g, ' ');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // 开头加 BOM，否则 Excel 打开中文会乱码
  const content = '\uFEFF' + [headers, ...rows].map((row) => row.map(escapeCell).join(delimiter)).join('\r\n') + '\r\n';
  const blob = new Blob([content], { type: isCsv ? 'text/csv;charset=utf-8;' : 'text/plain;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${baseName}.${isCsv ? 'csv' : 'txt'}`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ==================== 系统数据（数据库结构 + 演示数据）====================
