import axios from 'axios';
import { usePetStore } from '../store/authStore';
import { API_BASE_URL } from './apiBase';

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
    // FormData 必须让浏览器自己设Content-Type（它会附带 boundary=...）。
    //
    // 上面给实例设了 application/json 默认头，而 axios 遇到 FormData
    // 只会原样透传、不会删掉已存在的头。结果浏览器看到 application/json，
    // 就把FormData 当 JSON 序列化——File 对象没有可序列化的属性，
    // 实际发出去的是 {"file":{}}，服务端multer 拿不到文件，返回 400。
    //
    // 这里统一抹掉，避免每写一个上传接口都要记得手动覆盖。
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      delete config.headers['Content-Type'];
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
      localStorage.removeItem('currentClass');
      localStorage.removeItem('pet');
      usePetStore.getState().clearPet();
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
  register: (data: {
    username: string; password: string; email?: string; real_name?: string; role?: string;
    requested_class_id?: number; requested_class_ids?: number[]; teacher_type?: string;
    /** 一行一条任教关系：班级 + 身份 + 科目 */
    assignments?: Array<{ class_id: number; role: 'head_teacher' | 'teacher'; subject?: string }>;
  }) =>
    api.post('/auth/register', data),
  
  login: (data: { username: string; password: string }) => 
    api.post('/auth/login', data),
  
  getMe: () => api.get('/auth/me'),
  
  updateMe: (data: { email?: string; avatar?: string }) => 
    api.put('/auth/me', data),
  
  changePassword: (data: { currentPassword: string; newPassword: string }) => 
    api.put('/auth/change-password', data),
  
  // ===== 教师自助维护任教信息 =====
  /** 修改自己已有任教关系中的科目（即时生效，无需审批） */
  updateMyTeachingSubjects: (updates: Array<{ class_id: number; subject: string | null }>) =>
    api.put('/auth/me/teaching-subject', { updates }),
  /** 可申请加入的班级列表 */
  getTeachableClasses: () => api.get('/auth/me/teachable-classes'),
  /** 申请加入班级任教（需班主任/管理员审批） */
  requestJoinClass: (data: { class_id: number; subject?: string; teacher_type?: 'teacher' | 'head_teacher' }) =>
    api.post('/auth/me/join-class-request', data),

  getApprovalStatus: (username: string) =>
    api.get('/auth/approval-status', { params: { username } }),
};

// ===== 我的资产明细（金币 + 物品/装备/技能流水）=====
export const userAPI = {
  getMyTransactions: (params?: { type?: 'all' | 'gold' | 'item'; page?: number; pageSize?: number }) =>
    api.get('/users/me/transactions', { params }),
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
  
  // 提交出题任务：立即返回 task_id，耗时由后台执行，前端轮询进度即可
  generateQuestions: (data: { subject: string; topic?: string; difficulty?: string; question_type?: string; count?: number; grade_level?: string; mode?: 'topic' | 'requirements' | 'paste'; requirements?: string; raw_text?: string; type_specs?: Array<{ question_type: string; count: number; difficulty: string }> }, timeout?: number) =>
    api.post('/assignments/generate', data, { timeout: (timeout || 30) * 1000 }),

  // 轮询出题任务进度。请求都在 1 秒内返回，不会被网关超时切断
  getGenerateProgress: (taskId: string) =>
    api.get(`/assignments/generate/${taskId}`, { timeout: 15000 }),

  // 放弃一次「生成了但没发布」的出题：删除未使用的题目并退还本次额度
  abandonGeneration: (usageId: number) =>
    api.post(`/assignments/generate/abandon/${usageId}`),

  createAssignment: (data: any) => 
    api.post('/assignments', data),
  
  updateQuestion: (id: number, data: { content?: string; options?: any; answer?: any; explanation?: string; analysis?: string; knowledge_point?: string; difficulty?: string; hint?: string; sync_group?: boolean }) =>
    api.patch(`/assignments/questions/${id}`, data),
  
  submitAssignment: (id: number, data: { answers: any[]; attachments?: any[] }) => 
    api.post(`/assignments/${id}/submit`, data),
  
  getSubmissionDetail: (id: number) => 
    api.get(`/assignments/submissions/${id}`),
  
  getStatistics: (id: number) =>
    api.get(`/assignments/${id}/statistics`),

  /**
   * 教师代登记纸质作业成绩。
   *
   * overwrite=true 时允许覆盖该学生已有的登记（老师追加照片重新识别后
   * 要更正成绩）。后端会先回滚上一次登记发放的金币与知识点统计，
   * 避免反复覆盖刷金币。
   */
  paperSubmit: (id: number, data: { student_id: number; results: { question_id: number; is_correct: boolean; score?: number; student_answer?: string }[]; note?: string; overwrite?: boolean }) =>
    api.post(`/assignments/${id}/paper-submit`, data),

  paperSubmitBatch: (id: number, data: { submissions: { student_id: number; results: { question_id: number; is_correct: boolean; score?: number; student_answer?: string }[]; note?: string }[]; note?: string }) =>
    api.post(`/assignments/${id}/paper-submit-batch`, data),

  /** 纸质作业识别进度（出题与批量判分共用同一套任务查询） */
  getPaperJudgeProgress: (taskId: string) =>
    api.get(`/assignments/generate/${taskId}`, { timeout: 15000 }),

  getMyPersonalBank: (params?: { subject?: string; assignment_type?: string; only_wrong?: string | number; keyword?: string; page?: number; page_size?: number }) =>
    api.get('/assignments/personal-bank/my', { params }),

  getPersonalBankStats: () =>
    api.get('/assignments/personal-bank/stats'),

  removeFromPersonalBank: (id: number) =>
    api.delete(`/assignments/personal-bank/${id}`),

  getAssignmentTypeSummary: (params?: { class_id?: number; subject?: string; date_from?: string; date_to?: string }) =>
    api.get('/assignments/stats/type-summary', { params }),

  getMyWrongQuestions: (params?: { subject?: string }) => 
    api.get('/assignments/wrong/my', { params }),
  
  markWrongQuestionReviewed: (id: number) => 
    api.post(`/assignments/wrong/${id}/review`),

  /** 错题重做：客观题自动判，主观题传 self_marked_correct 自评 */
  retryWrongQuestions: (items: { wrong_id: number; answer?: any; self_marked_correct?: boolean; duration_ms?: number }[]) =>
    api.post('/assignments/wrong/retry', { items }),

  getWrongMastery: () => api.get('/assignments/wrong/mastery'),
  
  /**
   * 上传作答照片。传的是客户端压缩后的 Blob（长边 2000 / JPEG 0.82），
   * 手机原图直传有 3~5MB，压缩后通常只有几百 KB。
   */
  uploadImage: (file: Blob) => {
    const formData = new FormData();
    formData.append('file', file, 'answer.jpg');
    return api.post('/assignments/upload/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
  },

  cancelAssignment: (id: number) =>
    api.patch(`/assignments/${id}/cancel`),

  getRetryQuestions: (id: number) =>
    api.get(`/assignments/${id}/retry-questions`),

  // ===== 纸质作业扫描（批次制）=====
  // 逐张上传 + 按组识别 + 进度落库：关掉弹窗或重启服务都不影响，
  // 下次打开批次详情能看到「上次传了 12/20、识别到第 8 组」。
  /**
   * 创建扫描批次。
   *
   * @param studentId 只有单人登记会传：批次绑定到这个学生，
   *   后端会优先复用该学生未完成的批次。批量扫描不传（一个批次装着全班）。
   */
  createScanBatch: (assignmentId: number, groupSize?: number, studentId?: number | null) =>
    api.post(`/assignments/${assignmentId}/paper-scan/batches`, {
      group_size: groupSize || 1,
      ...(studentId ? { student_id: studentId } : {}),
    }),

  /** 单人登记：各学生的扫描进度（左侧列表显示「谁传了几张、谁判完了」） */
  getScanStudentProgress: (assignmentId: number) =>
    api.get(`/assignments/${assignmentId}/paper-scan/student-progress`),

  /**
   * 标记批次已登记（成绩已写入）。
   * 登记后不删批次——老师发现判错还要回来改。
   */
  markScanRegistered: (assignmentId: number, batchId: number) =>
    api.post(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/registered`),

  listScanBatches: (assignmentId: number) =>
    api.get(`/assignments/${assignmentId}/paper-scan/batches`),

  getScanBatch: (assignmentId: number, batchId: number) =>
    api.get(`/assignments/${assignmentId}/paper-scan/batches/${batchId}`),

  /**
   * 某张照片的可访问地址，用在 <img src> 上。
   * 走带 token 的请求：照片是学生的作答，不能当成公开静态资源直接暴露。
   * 用 fetch + blob 而不是 img 直链，是因为 img 标签带不上 Authorization 头。
   */
  fetchScanImage: async (assignmentId: number, batchId: number, imageId: number): Promise<string> => {
    const res = await api.get(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/images/${imageId}/file`, {
      responseType: 'blob',
      timeout: 30000,
    });
    return URL.createObjectURL(res.data as Blob);
  },

  /** 登记一张照片的占位（只记元信息，不传文件） */
  addScanImageMeta: (assignmentId: number, batchId: number, meta: { file_name: string; file_size: number; mime_type?: string }) =>
    api.post(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/images`, meta),

  /**
   * 上传某张照片的内容（multipart，单张，可回调进度）。
   *
   * 传的是客户端压缩后的 Blob，不是原图：手机原图 3~5MB，
   * 压完几百KB，慢速网络下差别是「等半天」和「几秒」。
   *
   * fileName 必须传真实文件名。服务端会用 multer 的 originalname
   * 覆盖 file_name，写死成 photo.jpg 会让所有照片都叫同一个名字，
   * 之后「刷新后认回已上传照片」就分不清谁是谁了。
   */
  uploadScanImage: (
    assignmentId: number,
    batchId: number,
    imageId: number,
    file: Blob,
    fileName: string,
    onProgress?: (percent: number) => void,
  ) => {
    const fd = new FormData();
    fd.append('file', file, fileName || 'photo.jpg');
    return api.post(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/images/${imageId}/file`, fd, {
      timeout: 120000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  },

  deleteScanImage: (assignmentId: number, batchId: number, imageId: number) =>
    api.delete(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/images/${imageId}`),

  setScanGroupSize: (assignmentId: number, batchId: number, groupSize: number) =>
    api.post(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/group-size`, { group_size: groupSize }),

  reorderScanImages: (assignmentId: number, batchId: number, imageIds: number[]) =>
    api.post(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/reorder`, { image_ids: imageIds }),

  /** 开始识别；restart='all' 表示清空上次结果重来 */
  startScan: (assignmentId: number, batchId: number, restart?: 'all') =>
    api.post(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/start`, { restart }),

  /** 取消识别：停止后续分组，已识别部分保留（不是回滚，因为还没登记） */
  cancelScan: (assignmentId: number, batchId: number) =>
    api.post(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/cancel`),

  resumeScan: (assignmentId: number, batchId: number) =>
    api.post(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/resume`),

  /** 把某份卷子指给某个学生（AI 认错名字时人工纠正，会持久化） */
  assignScanGroup: (assignmentId: number, batchId: number, groupNo: number, studentId: number | null, studentName?: string) =>
    api.post(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/groups/${groupNo}/assign`, {
      student_id: studentId,
      student_name: studentName || '',
    }),

  /** 保存某份卷子的逐题修正（改对错、改部分分），只覆盖传上来的题 */
  saveScanGroupResults: (assignmentId: number, batchId: number, groupNo: number, results: Array<{ question_id: number; is_correct?: boolean; score?: number; comment?: string }>) =>
    api.put(`/assignments/${assignmentId}/paper-scan/batches/${batchId}/groups/${groupNo}/results`, { results }),

  deleteScanBatch: (assignmentId: number, batchId: number) =>
    api.delete(`/assignments/${assignmentId}/paper-scan/batches/${batchId}`),
};

// ===== 学情报告（教师端）=====
export const learningReportAPI = {
  getOverview: (params: { class_id: number; subject?: string; date_from?: string; date_to?: string }) =>
    api.get('/learning-reports/overview', { params }),

  getKnowledgeMatrix: (params: { class_id: number; subject?: string; date_from?: string; date_to?: string; limit_kp?: number }) =>
    api.get('/learning-reports/knowledge-matrix', { params }),

  getStudents: (params: { class_id: number; subject?: string; date_from?: string; date_to?: string; limit?: number }) =>
    api.get('/learning-reports/students', { params }),

  getStudentReport: (params: { class_id: number; studentId: number; subject?: string; date_from?: string; date_to?: string }) =>
    api.get(`/learning-reports/student/${params.studentId}`, { params: { ...params, studentId: undefined } }),

  // 提交后立即返回 task_id，实际分析在后台跑
  generateAiReport: (data: { class_id: number; subject?: string; date_from?: string; date_to?: string }, timeout?: number) =>
    api.post('/learning-reports/ai-report', data, { timeout: (timeout || 30) * 1000 }),

  generateStudentAiReport: (data: { class_id: number; student_id: number; subject?: string; date_from?: string; date_to?: string }, timeout?: number) =>
    api.post('/learning-reports/ai-report/student', data, { timeout: (timeout || 30) * 1000 }),

  /** 学情报告生成进度 */
  getReportProgress: (taskId: string) =>
    api.get(`/learning-reports/ai-report/task/${taskId}`, { timeout: 15000 }),

  getAiReportHistory: (params: { class_id: number; report_type?: string; subject?: string; limit?: number }) =>
    api.get('/learning-reports/ai-report/history', { params }),

  getAiReport: (id: number) => api.get(`/learning-reports/ai-report/${id}`),
};

// 题库相关 API
export const questionBankAPI = {
  getQuestions: (params?: {
    page?: number;
    pageSize?: number;
    subject?: string;
    type?: string;
    difficulty?: string;
    knowledge_point?: string;
    grade_level?: string;
    source?: string;
    is_public?: number;
    keyword?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => api.get('/question-bank', { params }),

  getQuestion: (id: number) => api.get(`/question-bank/${id}`),
};

// 知识点相关 API
export const knowledgePointAPI = {
  getStats: (params?: { date?: string; days?: number }) => api.get('/knowledge-points', { params }),
  getList: () => api.get('/knowledge-points/list'),
  getHeatmap: (params?: { days?: number }) => api.get('/knowledge-points/heatmap', { params }),
  getWeakPoints: (params?: { days?: number; threshold?: number }) => api.get('/knowledge-points/weak-points', { params }),
  getSimilarQuestions: (params: { question_id: number; limit?: number }) =>
    api.get('/knowledge-points/similar-questions', { params }),
  getReviewEffectiveness: (params?: { recent_days?: number; base_days?: number }) =>
    api.get('/knowledge-points/review-effectiveness', { params }),
  getClassOverview: (classId: number, params?: { days?: number }) =>
    api.get(`/knowledge-points/class/${classId}/overview`, { params }),
  getClassStudentDetail: (classId: number, studentId: number, params?: { days?: number }) =>
    api.get(`/knowledge-points/class/${classId}/student/${studentId}`, { params }),
  getLearningTime: (params?: { days?: number }) =>
    api.get('/knowledge-points/learning-time', { params }),
};

// AI学习教练 API
export const aiCoachAPI = {
  getLearningPlan: (params?: { days?: number; force?: string }, timeout?: number) => api.get('/ai-coach/learning-plan', { params, timeout: (timeout || 30) * 1000 }),
  getDiagnosis: (params?: { days?: number; force?: string }, timeout?: number) => api.get('/ai-coach/diagnosis', { params, timeout: (timeout || 30) * 1000 }),
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

  getPendingRequests: () => api.get('/friends/pending-requests'),

  addFriend: (data: { friend_username: string }) =>
    api.post('/friends/add', data),

  acceptRequest: (data: { request_id: number }) =>
    api.post('/friends/accept-request', data),

  rejectRequest: (data: { request_id: number }) =>
    api.post('/friends/reject-request', data),

  searchFriends: (keyword: string) => api.get('/friends/search', { params: { keyword } }),

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

  getConditionTypes: () => api.get('/achievements/condition-types'),

  // 管理员
  adminGetItems: () => api.get('/achievements/admin/items'),
  adminCreate: (data: any) => api.post('/achievements/admin', data),
  adminUpdate: (id: number, data: any) => api.put(`/achievements/admin/${id}`, data),
  adminDelete: (id: number) => api.delete(`/achievements/admin/${id}`),
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
  getLevelLeaderboard: (params?: { class_id?: number; limit?: number }) =>
    api.get('/leaderboard/level', { params }),
  getBattleLeaderboard: (params?: { class_id?: number; limit?: number }) =>
    api.get('/leaderboard/battle', { params }),
  getAssignmentLeaderboard: (params?: { class_id?: number; limit?: number }) =>
    api.get('/leaderboard/assignment', { params }),
};

export const adminAPI = {
  // 教师管理
  createTeacher: (data: {
    username: string;
    password: string;
    real_name?: string;
    email?: string;
    class_id?: number;
    class_ids?: number[];
    teacher_identity?: 'head_teacher' | 'teacher';
    /** 一行一条任教关系：班级 + 身份 + 科目（与编辑教师共用同一结构） */
    assignments?: Array<{ class_id: number; role: 'head_teacher' | 'teacher'; subject?: string }>;
  }) => api.post('/admin/teachers', data),
  getTeachers: (params?: { status?: string; search?: string }) => api.get('/admin/teachers', { params }),
  getPendingTeachers: () => api.get('/admin/pending-teachers'),
  approveTeacher: (teacher_id: number, action: 'approve' | 'reject') => api.post('/admin/approve-teacher', { teacher_id, action }),
  updateTeacher: (id: number, data: any) => api.put(`/admin/teachers/${id}`, data),
  deleteTeacher: (id: number, action: 'delete' | 'disable') => api.delete(`/admin/teachers/${id}`, { data: { action } }),

  // 学生管理
  getStudents: (params?: { status?: string; class_id?: number; search?: string }) => api.get('/admin/students', { params }),
  getStudentDetail: (id: number) => api.get(`/admin/students/${id}`),
  updateStudent: (id: number, data: any) => api.put(`/admin/students/${id}`, data),
  // 批量重置学生密码：不传 password 时后端生成随机 6 位密码，返回 results 含明文新密码
  resetStudentPasswords: (data: { student_ids: number[]; password?: string }) => api.post('/admin/students/reset-passwords', data),
  adjustStudentGold: (id: number, amount: number, reason?: string) => api.post(`/admin/students/${id}/gold`, { amount, reason }),
  deleteStudent: (id: number, action: 'delete' | 'disable') => api.delete(`/admin/students/${id}`, { data: { action } }),
  importStudents: (classId: number, students: any[]) => api.post('/admin/students/import', { class_id: classId, students }),
  getImportTemplate: (format?: 'json' | 'csv') => api.get('/admin/students/import-template', { params: { format } }),
  // 粘贴姓名 → 生成账号密码（mode: ai=AI 生成拼音账号；sequence=按前缀+序号，AI 不可用时用）
  // AI 模式下 200 个账号要串行跑十几批 AI，已改为后台任务 + 轮询进度
  generateStudentAccounts: (data: { names: string; mode?: 'ai' | 'sequence'; prefix?: string; class_id?: number }) =>
    api.post('/admin/students/generate-accounts', data, { timeout: 30 * 1000 }),
  /** 学生账号生成进度 */
  getStudentAccountsProgress: (taskId: string) =>
    api.get(`/admin/students/task/${taskId}`, { timeout: 15000 }),

  // 班级管理
  getClasses: () => api.get('/admin/classes'),
  createClass: (data: { name: string; grade?: string; teacher_id?: number }) => api.post('/admin/classes', data),
  updateClass: (id: number, data: any) => api.put(`/admin/classes/${id}`, data),
  deleteClass: (id: number) => api.delete(`/admin/classes/${id}`),
  addTeacherToClass: (classId: number, data: { teacher_id: number; role?: string }) => api.post(`/admin/classes/${classId}/teachers`, data),
  // 修改教师在某班内的身份：'head_teacher' | 'teacher'
  updateClassTeacherRole: (classId: number, teacherId: number, role: 'head_teacher' | 'teacher') =>
    api.put(`/admin/classes/${classId}/teachers/${teacherId}`, { role }),
  removeTeacherFromClass: (classId: number, teacherId: number) => api.delete(`/admin/classes/${classId}/teachers/${teacherId}`),

  // 班级申请审批
  getClassApplications: (params?: { class_id?: number; status?: string }) => api.get('/admin/class-applications', { params }),
  reviewClassApplication: (id: number, data: { status: 'approved' | 'rejected' }) => api.put(`/admin/class-applications/${id}/review`, data),

  // 未分班学生 / 指派到班级
  getUnassignedStudents: () => api.get('/admin/unassigned-students'),
  assignStudentToClass: (studentId: number, class_id: number) =>
    api.post(`/admin/students/${studentId}/assign-class`, { class_id }),

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

  deleteAssignment: (id: number) => api.delete(`/admin/assignments/${id}`),

  deleteAssignmentQuestion: (assignmentId: number, questionId: number) =>
    api.delete(`/admin/assignments/${assignmentId}/questions/${questionId}`),

  // 商店购买记录
  getShopRecords: (params?: { class_id?: number }) => api.get('/admin/shop-records', { params }),

  // AI设置
  getAISettings: () => api.get('/admin/settings/ai'),
  saveAISettings: (settings: any) => api.post('/admin/settings/ai', settings),
  // 连通性测试只发一句话，正常几秒返回；30 秒足够，缺省会一直挂着
  testAIConnection: (settings: any) => api.post('/admin/settings/ai/test', settings, { timeout: 30 * 1000 }),

  // 网站设置
  getSiteSettings: () => api.get('/admin/settings/site'),
  saveSiteSettings: (settings: any) => api.post('/admin/settings/site', settings),

  // AI提示词设置
  getPromptSettings: () => api.get('/admin/settings/prompts'),
  savePromptSettings: (prompts: Record<string, string>) => api.post('/admin/settings/prompts', { prompts }),
  resetPromptSettings: (keys?: string[]) => api.post('/admin/settings/prompts/reset', { keys }),

  // 公开设置（无需认证）
  getPublicSettings: () => api.get('/admin/settings/public'),

  // 公开统计（无需认证）
  getPublicStatistics: () => api.get('/admin/statistics/public'),

  // ===== 软件升级 =====
  getUpdateInfo: () => api.get('/admin/system/update/info'),
  setUpdateSource: (url: string) => api.put('/admin/system/update/source', { url }),
  checkUpdate: () => api.post('/admin/system/update/check'),
  getUpdateStatus: () => api.get('/admin/system/update/status'),
  // 提交即返回，进度靠 getUpdateStatus 轮询（原先同步等完成，会被网关 60s 切断）
  applyUpdate: (version: string) => api.post('/admin/system/update/apply', { version }, { timeout: 30 * 1000 }),
  getUpdateBackups: () => api.get('/admin/system/update/backups'),
  rollbackUpdate: (file: string) => api.post('/admin/system/update/rollback', { file }, { timeout: 30 * 1000 }),
  getUpdateLog: () => api.get('/admin/system/update/log'),
  restartService: () => api.post('/admin/system/update/restart'),

  // 运营看板
  getOperationalStats: () => api.get('/admin/operational-stats'),  getClassTeacherActivity: (classId: number) => api.get(`/admin/classes/${classId}/teacher-activity`),

  getTokenUsageDashboard: () => api.get('/admin/token-usage/dashboard'),
  getTokenUsageRecords: (params?: { user_id?: number; date?: string; page?: number; pageSize?: number }) => api.get('/admin/token-usage/records', { params }),
  getMyGenLimit: () => api.get('/admin/token-usage/my-limit'),

  cleanAllData: () => api.post('/admin/clean-all-data'),

  // 系统数据管理（结构迁移 + 演示数据）
  getSystemStatus: () => api.get('/admin/system/status'),
  runSystemMigrate: () => api.post('/admin/system/migrate'),
  importDemoData: (data?: { updateNotices?: boolean }) => api.post('/admin/system/demo-data', data || {}),
  clearDemoData: () => api.delete('/admin/system/demo-data'),
  resetSystem: (confirm: string) => api.post('/admin/system/reset', { confirm }),
};

// 装备部件相关 API
export const equipmentAPI = {
  getAll: () => api.get('/equipment/all'),
  getMyEquipment: () => api.get('/equipment/my-equipment'),
  equipPart: (data: { user_equip_id: number }) => api.post('/equipment/equip', data),
  upgradePart: (data: { user_equip_id: number }) => api.post('/equipment/upgrade', data),
  getShop: () => api.get('/equipment/shop'),
  buyEquipment: (data: { equipment_id: number }) => api.post('/equipment/buy', data),
  sellEquipment: (data: { user_equip_id: number }) => api.post('/equipment/sell', data),
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
    api.get('/notifications', { params }),

  getUnreadCount: () => api.get('/notifications/unread-count'),

  markAsRead: (notificationId: number) => api.put(`/notifications/${notificationId}/read`),

  markAllAsRead: () => api.put('/notifications/read-all'),

  deleteNotification: (notificationId: number) => api.delete(`/notifications/${notificationId}`),

  clearReadNotifications: () => api.delete('/notifications/clear-read'),
};

// 班级邀请系统相关 API
export const classAPI = {
  // 教师创建班级
  createClass: (data: { name: string; grade?: string }) =>
    api.post('/classes/create', data),

  // 获取教师作为班主任的班级
  getMyClass: () => api.get('/classes/my-class'),

  // 生成邀请码
  createInvitation: (classId: number, data?: { role_filter?: string; max_uses?: number; expires_at?: string }) =>
    api.post(`/classes/${classId}/invitations`, data),

  // 获取班级邀请码列表
  getInvitations: (classId: number) =>
    api.get(`/classes/${classId}/invitations`),

  // 启用/禁用邀请码
  toggleInvitation: (invitationId: number) =>
    api.put(`/classes/invitations/${invitationId}/toggle`),

  // 验证邀请码
  validateInvitation: (invitationCode: string) =>
    api.post('/classes/invitations/validate', { invitation_code: invitationCode }),

  // 通过邀请码注册（新用户）
  registerWithInvite: (data: { username: string; password: string; email?: string; role: string; invitation_code: string }) =>
    api.post('/classes/register-with-invite', data),

  // 已注册用户通过邀请码加入班级
  joinWithInvite: (invitationCode: string) =>
    api.post('/classes/join-with-invite', { invitation_code: invitationCode }),

  getPublicClasses: () => api.get('/classes/public-list'),

  // 通过 slug 获取班级公开主页（无需登录）
  getBySlug: (slug: string) => api.get(`/classes/by-slug/${encodeURIComponent(slug)}`),

  // 班级主页聚合数据（需登录）
  getHomeSummary: (classId: number) => api.get(`/classes/${classId}/home-summary`),

  // 更新班级设置（班主任）
  updateClassSettings: (classId: number, data: { description?: string; cover_image?: string; is_public?: boolean }) =>
    api.put(`/classes/${classId}/settings`, data),

  // 班主任自定义班级 slug
  updateClassSlug: (classId: number, slug: string) =>
    api.put(`/classes/${classId}/slug`, { slug }),
};

// 学校相关 API
export const schoolAPI = {
  getSchools: () => api.get('/schools'),
  createSchool: (data: { name: string; city?: string; region?: string; theme_color?: string }) =>
    api.post('/schools', data),
  updateSchool: (id: number, data: { name?: string; city?: string; region?: string; theme_color?: string; logo?: string }) =>
    api.put(`/schools/${id}`, data),
  deleteSchool: (id: number) => api.delete(`/schools/${id}`),
  getClassesOfSchool: (schoolId: number) => api.get(`/schools/${schoolId}/classes`),
};

// BOSS战相关 API
export const bossBattleAPI = {
  getCurrentBoss: (classId: number) => api.get(`/boss-battles/current/${classId}`),
  listBosses: (classId: number) => api.get(`/boss-battles/list/${classId}`),
  getQuestion: (bossId: number) => api.get(`/boss-battles/${bossId}/question`),
  attack: (bossId: number, data: { question_id: number; answer: string }) =>
    api.post(`/boss-battles/${bossId}/attack`, data),
  create: (data: {
    class_id: number; boss_name: string; boss_level: number;
    boss_icon?: string; boss_description?: string;
    knowledge_point?: string; duration_hours?: number;
    boss_hp?: number; reward_gold?: number; reward_exp?: number;
    reward_equipment_id?: number; question_source?: string;
    question_ids?: number[];
  }) => api.post('/boss-battles/create', data),
  autoGenerate: (data: { class_id: number; duration_hours?: number }) =>
    api.post('/boss-battles/auto-generate', data),
  claimReward: (bossId: number) =>
    api.post(`/boss-battles/${bossId}/claim-reward`),
  getDetail: (bossId: number) =>
    api.get(`/boss-battles/${bossId}/detail`),
  terminate: (bossId: number) =>
    api.post(`/boss-battles/${bossId}/terminate`),
  deleteBoss: (bossId: number) =>
    api.delete(`/boss-battles/${bossId}`),
  getWrongQuestions: (classId: number, params?: {
    page?: number; pageSize?: number;
    subject?: string; type?: string; difficulty?: string; keyword?: string;
  }) => api.get(`/boss-battles/wrong-questions/${classId}`, { params }),
  getQuestions: (params?: {
    page?: number; pageSize?: number;
    subject?: string; type?: string; difficulty?: string; keyword?: string;
  }) => api.get('/boss-battles/questions', { params }),
  getHistory: (classId: number) =>
    api.get(`/boss-battles/history/${classId}`),
};

// 卡系统相关 API
export const cardAPI = {
  getBatches: (params?: { class_id?: number }) => api.get('/cards/batches', { params }),
  createBatch: (data: {
    name: string; type: string; reward_type: string;
    reward_value: string | number; reward_name?: string;
    quantity: number; class_id?: number; note?: string; expires_at?: string;
  }) => api.post('/cards/batches', data),
  getBatchCards: (batchId: number, params?: { page?: number; pageSize?: number; status?: string }) =>
    api.get(`/cards/batches/${batchId}/cards`, { params }),
  deleteBatch: (batchId: number) => api.delete(`/cards/batches/${batchId}`),
  invalidateCard: (cardId: number) => api.put(`/cards/${cardId}/invalidate`),
  redeemCard: (code: string) => api.post('/cards/redeem', { code }),
  getRedemptionLogs: (params?: { page?: number; pageSize?: number; user_id?: number }) =>
    api.get('/cards/redemption-logs', { params }),
};

// 课堂做题相关 API
export const classroomQuizAPI = {
  createQuiz: (data: {
    title: string; description?: string; subject?: string;
    class_id: number;
    /** 题干必填；courseware_html 为该题附带的 HTML 课件（可选），answer_text 为参考答案（可选） */
    questions: Array<{ question_text: string; courseware_html?: string; answer_text?: string }>;
  }) => api.post('/cards/classroom-quiz', data),
  getQuizzes: (params?: { class_id?: number; status?: string }) =>
    api.get('/cards/classroom-quiz', { params }),
  getQuizDetail: (quizId: number) => api.get(`/cards/classroom-quiz/${quizId}`),
  updateQuizStatus: (quizId: number, status: string) =>
    api.put(`/cards/classroom-quiz/${quizId}`, { status }),
  rewardStudent: (quizId: number, data: {
    student_id?: number; student_ids?: number[]; pet_id?: number; reward_type: string;
    reward_value: string | number; reward_name?: string;
    question_id?: number; reason?: string;
  }) => api.post(`/cards/classroom-quiz/${quizId}/reward`, data),
  getClassStudents: (classId: number) =>
    api.get(`/cards/classroom-quiz/students/${classId}`),
  // 提交后立即返回 task_id，实际出题在后台跑
  aiGenerate: (data: { subject: string; topic?: string; question_type?: string; count?: number; difficulty?: string; grade_level?: string; mode?: 'topic' | 'requirements' | 'paste'; requirements?: string; raw_text?: string; /** 多组出题：一行一条「题型 + 题目数量」，一次请求只计 1 次生成额度 */ batches?: Array<{ type: string; count: number }> }, timeout?: number) =>
    api.post('/cards/classroom-quiz/ai-generate', data, { timeout: (timeout || 30) * 1000 }),
  aiJudge: (data: { subject?: string; question_text: string; reference_answer?: string; student_answer: string }, timeout?: number) =>
    api.post('/cards/classroom-quiz/ai-judge', data, { timeout: (timeout || 30) * 1000 }),
  /** 课堂做题出题/判分进度 */
  getQuizTaskProgress: (taskId: string) =>
    api.get(`/cards/classroom-quiz/task/${taskId}`, { timeout: 15000 }),
  saveAnswer: (quizId: number, data: { question_id?: number; student_id: number; answer_text?: string; judged_by_ai?: boolean; is_correct?: boolean; score?: number; coin_rewarded?: number }) =>
    api.post(`/cards/classroom-quiz/${quizId}/answers`, data),
  updateAnswerReward: (answerId: number, coin_rewarded: number) =>
    api.put(`/cards/classroom-quiz/answers/${answerId}`, { coin_rewarded }),
};

// AI 助手直连：令牌由教师在页面里生成，AI 用它直接调用 /api/agent/* 提交数据
export const agentTokenAPI = {
  list: () => api.get('/agent-tokens'),
  create: (name?: string) => api.post('/agent-tokens', { name }),
  revoke: (id: number) => api.delete(`/agent-tokens/${id}`),
};

export const agentAPI = {
  /** 用令牌自检连接 + 读接口自述 */
  introspect: (agentToken: string) =>
    api.get('/agent/', { headers: { 'X-Agent-Token': agentToken } }),
  /** 令牌代表的老师身份、任教班级与任教科目 */
  whoami: (agentToken: string) =>
    api.get('/agent/whoami', { headers: { 'X-Agent-Token': agentToken } }),
};

export default api;