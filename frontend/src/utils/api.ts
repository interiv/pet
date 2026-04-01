import axios from 'axios';

const API_BASE_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:3000/api';

// 创建 axios 实例
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器 - 添加 token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 处理错误
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // 如果是未登录且不是访问需要认证的接口，不跳转
    if (error.response?.status === 401) {
      // 允许获取排行榜和所有宠物列表时返回 401 不跳转
      const url = error.config?.url;
      if (url && (url.includes('/pets/all') || url.includes('/leaderboard'))) {
        return Promise.reject(error);
      }
      
      // token 过期或无效，清除并跳转登录页
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // 只有在明确需要登录的页面才跳转
      if (window.location.pathname !== '/' && window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// 认证相关 API
export const authAPI = {
  register: (data: { username: string; password: string; email?: string }) => 
    api.post('/auth/register', data),
  
  login: (data: { username: string; password: string }) => 
    api.post('/auth/login', data),
  
  getMe: () => api.get('/auth/me'),
  
  updateMe: (data: { email?: string; avatar?: string }) => 
    api.put('/auth/me', data),
  
  changePassword: (data: { currentPassword: string; newPassword: string }) => 
    api.put('/auth/change-password', data),
};

// 宠物相关 API
export const petAPI = {
  getMyPet: () => api.get('/pets/my-pet'),
  
  createPet: (data: { name: string; species_id: number }) => 
    api.post('/pets/create', data),
  
  updatePet: (data: { name?: string; attack?: number; defense?: number; speed?: number }) => 
    api.put('/pets/update', data),
  
  feedPet: (data: { item_id: number }) => 
    api.post('/pets/feed', data),
  
  getAllPets: () => api.get('/pets/all'),
  
  getSpecies: () => api.get('/pets/species'),
  
  getUserPet: (userId: number) => api.get(`/pets/user/${userId}`),
};

// 作业相关 API
export const assignmentAPI = {
  getAssignments: () => api.get('/assignments'),
  
  getAssignment: (id: number) => api.get(`/assignments/${id}`),
  
  createAssignment: (data: any) => 
    api.post('/assignments', data),
  
  submitAssignment: (id: number, data: { answers: any; attachments?: any[] }) => 
    api.post(`/assignments/${id}/submit`, data),
  
  gradeAssignment: (data: { submission_id: number }) => 
    api.post('/assignments/grade', data),
};

// 战斗相关 API
export const battleAPI = {
  startBattle: (data: { opponent_pet_id: number }) => 
    api.post('/battles/start', data),
  
  getBattleHistory: () => api.get('/battles/history'),
};

// 物品相关 API
export const itemAPI = {
  getItems: () => api.get('/items'),
  
  buyItem: (data: { item_id: number; quantity?: number }) => 
    api.post('/items/buy', data),
  
  getMyItems: () => api.get('/items/my-items'),
};

// 好友相关 API
export const friendAPI = {
  getFriends: () => api.get('/friends/list'),
  
  addFriend: (data: { friend_username: string }) => 
    api.post('/friends/add', data),
};

// 成就相关 API
export const achievementAPI = {
  getAchievements: () => api.get('/achievements/list'),
  
  getMyAchievements: () => api.get('/achievements/my-achievements'),
};

// 排行榜相关 API
export const leaderboardAPI = {
  getLevelLeaderboard: () => api.get('/leaderboard/level'),
  getBattleLeaderboard: () => api.get('/leaderboard/battle'),
  getAssignmentLeaderboard: () => api.get('/leaderboard/assignment'),
};

export const adminAPI = {
  getPendingTeachers: () => api.get('/admin/pending-teachers'),
  approveTeacher: (teacher_id: number, action: 'approve' | 'reject') => api.post('/admin/approve-teacher', { teacher_id, action }),
  getAISettings: () => api.get('/admin/settings/ai'),
  saveAISettings: (settings: any) => api.post('/admin/settings/ai', settings),
};

// 装备部件相关 API
export const equipmentAPI = {
  getMyEquipment: () => api.get('/equipment/my-equipment'),
  equipPart: (data: { user_equip_id: number }) => api.post('/equipment/equip', data),
  upgradePart: (data: { user_equip_id: number }) => api.post('/equipment/upgrade', data),
};

export default api;
