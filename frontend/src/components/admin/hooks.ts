// Admin 模块共用 hooks（由 Admin.tsx 拆分而来，内容未改动）
import { useEffect, useState } from 'react';

export const useTablePagination = (defaultPageSize = 10) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  return {
    current: page,
    pageSize,
    onChange: (p: number, ps: number) => { setPage(p); setPageSize(ps); },
    showSizeChanger: true,
    pageSizeOptions: ['10', '20', '50'],
    showTotal: (total: number) => `共 ${total} 条`
  };
};

export const useMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
};
