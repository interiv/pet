import { create } from 'zustand';
import { authAPI, adminAPI } from '../utils/api';

interface User {
  id: number;
  username: string;
  real_name?: string | null;
  email?: string;
  role: 'student' | 'teacher' | 'admin';
  class_id?: number;
  class_slug?: string;
  class_name?: string;
  school_id?: number;
  school_name?: string;
  school_theme?: string;
  avatar?: string;
  gold?: number;
  teacher_classes?: Array<{
    id: number;
    name: string;
    slug: string;
    grade?: string;
    class_role?: string;
    /** 任教科目（class_teachers.subject）。历史数据可能为 null，前端需容错 */
    subject?: string | null;
  }>;
}

interface CurrentClass {
  id: number;
  slug: string;
  name: string;
  theme_color?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  currentClass: CurrentClass | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  checkAuth: () => Promise<void>;
  setUser: (user: User) => void;
  setCurrentClass: (c: CurrentClass | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  currentClass: (() => {
    const raw = localStorage.getItem('currentClass');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  })(),
  
  login: (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },
  
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('currentClass');
    set({ token: null, user: null, isAuthenticated: false, currentClass: null });
    usePetStore.getState().clearPet();
  },
  
  checkAuth: async () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    
    if (!token) {
      set({ token: null, user: null, isAuthenticated: false });
      return;
    }
    
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        set({ token, user, isAuthenticated: true });
      } catch (e) {
        console.error('解析用户信息失败', e);
      }
    }
    
    try {
      const response = await authAPI.getMe();
      set({ user: response.data.user, isAuthenticated: true });
      localStorage.setItem('user', JSON.stringify(response.data.user));
    } catch (error) {
      console.error('验证token失败', error);
      // Token 无效或过期，清除登录状态
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('currentClass');
      set({ token: null, user: null, isAuthenticated: false, currentClass: null });
    }
  },
  
  setUser: (user) => {
    localStorage.setItem('user', JSON.stringify(user));
    set({ user });
  },

  setCurrentClass: (c) => {
    if (c) localStorage.setItem('currentClass', JSON.stringify(c));
    else localStorage.removeItem('currentClass');
    set({ currentClass: c });
  },
}));

interface PetState {
  pet: any | null;
  hasPet: boolean;
  setPet: (pet: any) => void;
  clearPet: () => void;
}

export const usePetStore = create<PetState>((set) => ({
  pet: null,
  hasPet: false,
  
  setPet: (pet) => {
    localStorage.setItem('pet', JSON.stringify(pet));
    set({ pet, hasPet: true });
  },
  
  clearPet: () => {
    localStorage.removeItem('pet');
    set({ pet: null, hasPet: false });
  },
}));

// =====站点设置 / 功能开关 =====

interface SiteSettingsState {
  settings: Record<string, string>;
  loaded: boolean;
  loadSiteSettings: () => Promise<void>;
}

const SITE_SETTINGS_CACHE = 'site_settings';

function readSiteSettingsCache(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(SITE_SETTINGS_CACHE) || '{}');
  } catch {
    return {};
  }
}

/**
 * 站点设置（含全部功能开关）的全局状态。
 *
 * 原先只有 Home.tsx 用 useState 单独拉一次，PetCenter 这类子组件拿不到开关值，
 * 菜单就没法按开关隐藏。统一放到 store 后按需订阅，并用 sessionStorage 缓存，
 * 避免每次切页重复请求。拉取失败时不做任何隐藏，避免误伤功能。
 */
export const useSiteSettingsStore = create<SiteSettingsState>((set, get) => ({
  settings: readSiteSettingsCache(),
  loaded: Object.keys(readSiteSettingsCache()).length > 0,

  loadSiteSettings: async () => {
    if (get().loaded) return;
    try {
      const res = await adminAPI.getPublicSettings();
      const data = res.data.settings || {};
      try {
        sessionStorage.setItem(SITE_SETTINGS_CACHE, JSON.stringify(data));
      } catch (e) { /* 隐私模式写入失败可忽略 */ }
      set({ settings: data, loaded: true });
    } catch (e) {
      set({ loaded: true });
    }
  },
}));
