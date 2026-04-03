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
  
  getAllPets: (params?: { class_id?: number }) => api.get('/pets/all', { params }),
  
  getSpecies: () => api.get('/pets/species'),
  
  getUserPet: (userId: number) => api.get(`/pets/user/${userId}`),
};

// 作业相关 API
export const assignmentAPI = {
  getAssignments: (params?: { class_id?: number }) => api.get('/assignments', { params }),
  
  getAssignment: (id: number) => api.get(`/assignments/${id}`),
  
  generateQuestions: (data: { subject: string; topic: string; difficulty?: string; question_type: string; count?: number; grade_level?: string }) =>
    api.post('/assignments/generate', data),
  
  createAssignment: (data: any) => 
    api.post('/assignments', data),
  
  submitAssignment: (id: number, data: { answers: any[]; attachments?: any[] }) => 
    api.post(`/assignments/${id}/submit`, data),
  
  getSubmissionDetail: (id: number) => 
    api.get(`/assignments/submissions/${id}`),
  
  getStatistics: (id: number) => 
    api.get(`/assignments/${id}/statistics`),
  
  getMyWrongQuestions: (params?: { subject?: string }) => 
    api.get('/assignments/wrong/my', { params }),
  
  markWrongQuestionReviewed: (id: number) => 
    api.post(`/assignments/wrong/${id}/review`),
  
  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/assignments/upload/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
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

  visitFriend: (data: { friend_id: number }) =>
    api.post('/friends/visit', data),

  giftFriend: (data: { friend_id: number; item_id: number }) =>
    api.post('/friends/gift', data),

  friendBattle: (data: { friend_id: number }) =>
    api.post('/friends/friend-battle', data),

  removeFriend: (data: { friend_id: number }) =>
    api.delete('/friends/remove', { data }),
};

// 成就相关 API
export const achievementAPI = {
  getAchievements: () => api.get('/achievements/list'),

  getMyAchievements: () => api.get('/achievements/my-achievements'),

  getAchievementStatus: () => api.get('/achievements/status'),

  checkAchievement: (data: { type: string; value: number }) =>
    api.post('/achievements/check', data),
};

// 宠物相关 API 扩展
export const petExtendedAPI = {
  revivePet: (data: { item_id?: number }) =>
    api.post('/pets/revive', data),

  rebirthPet: (data: { item_id: number }) =>
    api.post('/pets/rebirth', data),

  learnSkill: (data: { skill_id: number }) =>
    api.post('/pets/learn-skill', data),

  forgetSkill: (data: { skill_id: number }) =>
    api.post('/pets/forget-skill', data),

  getMySkills: () => api.get('/pets/skills'),

  getAllSkills: () => api.get('/pets/all-skills'),
};

// 排行榜相关 API
export const leaderboardAPI = {
  getLevelLeaderboard: () => api.get('/leaderboard/level'),
  getBattleLeaderboard: () => api.get('/leaderboard/battle'),
  getAssignmentLeaderboard: () => api.get('/leaderboard/assignment'),
};

export const adminAPI = {
  // 教师管理
  getTeachers: (params?: { status?: string; search?: string }) => api.get('/admin/teachers', { params }),
  getPendingTeachers: () => api.get('/admin/pending-teachers'),
  approveTeacher: (teacher_id: number, action: 'approve' | 'reject') => api.post('/admin/approve-teacher', { teacher_id, action }),
  updateTeacher: (id: number, data: any) => api.put(`/admin/teachers/${id}`, data),
  deleteTeacher: (id: number, action: 'delete' | 'disable') => api.delete(`/admin/teachers/${id}`, { data: { action } }),

  // 学生管理
  getStudents: (params?: { status?: string; class_id?: number; search?: string }) => api.get('/admin/students', { params }),
  getStudentDetail: (id: number) => api.get(`/admin/students/${id}`),
  updateStudent: (id: number, data: any) => api.put(`/admin/students/${id}`, data),
  adjustStudentGold: (id: number, amount: number, reason?: string) => api.post(`/admin/students/${id}/gold`, { amount, reason }),
  deleteStudent: (id: number, action: 'delete' | 'disable') => api.delete(`/admin/students/${id}`, { data: { action } }),

  // 班级管理
  getClasses: () => api.get('/admin/classes'),
  createClass: (data: { name: string; grade?: string; teacher_id?: number }) => api.post('/admin/classes', data),
  updateClass: (id: number, data: any) => api.put(`/admin/classes/${id}`, data),
  deleteClass: (id: number) => api.delete(`/admin/classes/${id}`),
  addTeacherToClass: (classId: number, data: { teacher_id: number; role?: string }) => api.post(`/admin/classes/${classId}/teachers`, data),
  removeTeacherFromClass: (classId: number, teacherId: number) => api.delete(`/admin/classes/${classId}/teachers/${teacherId}`),

  // 班级申请审批
  getClassApplications: (params?: { class_id?: number; status?: string }) => api.get('/admin/class-applications', { params }),
  reviewClassApplication: (id: number, data: { status: 'approved' | 'rejected' }) => api.put(`/admin/class-applications/${id}/review`, data),

  // 公告管理
  getAnnouncements: () => api.get('/admin/announcements'),
  createAnnouncement: (data: { title: string; content?: string; class_ids?: number[]; priority?: number; expires_at?: string }) => api.post('/admin/announcements', data),
  updateAnnouncement: (id: number, data: any) => api.put(`/admin/announcements/${id}`, data),
  deleteAnnouncement: (id: number) => api.delete(`/admin/announcements/${id}`),

  // 数据统计
  getStatistics: () => api.get('/admin/statistics'),

  // 战斗记录
  getBattles: (params?: { class_id?: number }) => api.get('/admin/battles', { params }),

  // 作业记录
  getAssignments: (params?: { class_id?: number }) => api.get('/admin/assignments', { params }),

  // 商店购买记录
  getShopRecords: (params?: { class_id?: number }) => api.get('/admin/shop-records', { params }),

  // AI设置
  getAISettings: () => api.get('/admin/settings/ai'),
  saveAISettings: (settings: any) => api.post('/admin/settings/ai', settings),
};

// 装备部件相关 API
export const equipmentAPI = {
  getMyEquipment: () => api.get('/equipment/my-equipment'),
  equipPart: (data: { user_equip_id: number }) => api.post('/equipment/equip', data),
  upgradePart: (data: { user_equip_id: number }) => api.post('/equipment/upgrade', data),
};

// 动态/留言板相关 API
export const postAPI = {
  getPosts: (params?: { type?: string; class_id?: number; page?: number; limit?: number }) =>
    api.get('/posts/posts', { params }),

  createPost: (data: { content: string; images?: string[]; scope?: string; class_id?: number }) =>
    api.post('/posts/posts', data),

  deletePost: (id: number) => api.delete(`/posts/posts/${id}`),

  toggleLike: (id: number) => api.post(`/posts/posts/${id}/like`),

  addComment: (postId: number, data: { content: string; parent_id?: number }) =>
    api.post(`/posts/posts/${postId}/comments`, data),

  deleteComment: (commentId: number) => api.delete(`/posts/comments/${commentId}`),

  togglePin: (id: number, is_top: boolean) => api.put(`/posts/posts/${id}/pin`, { is_top }),
};

// 聊天系统相关 API
export const chatAPI = {
  getConversations: () => api.get('/chat/conversations'),

  getMessages: (params: { room_type: 'class' | 'private'; room_id?: number; target_user_id?: number; page?: number; limit?: number }) =>
    api.get('/chat/messages', { params }),

  sendMessage: (data: { content: string; room_type: 'class' | 'private'; room_id?: number; target_user_id?: number; msg_type?: string }) =>
    api.post('/chat/messages', data),

  searchUsers: (keyword: string) => api.get('/chat/search-users', { params: { keyword } }),

  deleteMessage: (msgId: number) => api.delete(`/chat/messages/${msgId}`),
};

// 论坛相关 API
export const forumAPI = {
  getForums: () => api.get('/forum/forums'),

  getThreads: (params?: { forum_id?: number; keyword?: string; sort?: string; page?: number; limit?: number }) =>
    api.get('/forum/threads', { params }),

  getThreadDetail: (threadId: number) => api.get(`/forum/threads/${threadId}`),

  createThread: (data: { title: string; content: string; forum_id: number; tags?: string[] }) =>
    api.post('/forum/threads', data),

  replyThread: (threadId: number, data: { content: string; parent_id?: number }) =>
    api.post(`/forum/threads/${threadId}/reply`, data),

  toggleThreadLike: (threadId: number) => api.post(`/forum/threads/${threadId}/like`),

  togglePostLike: (postId: number) => api.post(`/forum/posts/${postId}/like`),

  toggleFavorite: (threadId: number) => api.post(`/forum/threads/${threadId}/favorite`),

  getFavorites: () => api.get('/forum/favorites'),

  deleteThread: (threadId: number) => api.delete(`/forum/threads/${threadId}`),
};

// 通知系统相关 API
export const notificationAPI = {
  getNotifications: (params?: { type?: string; page?: number; limit?: number }) =>
    api.get('/notifications/', { params }),

  getUnreadCount: () => api.get('/notifications/unread-count'),

  markAsRead: (notificationId: number) => api.put(`/notifications/${notificationId}/read`),

  markAllAsRead: () => api.put('/notifications/read-all'),

  deleteNotification: (notificationId: number) => api.delete(`/notifications/${notificationId}`),

  clearReadNotifications: () => api.delete('/notifications/clear-read'),
};

export default api;
