import { create } from 'zustand';
import { authAPI } from '../utils/api';

interface User {
  id: number;
  username: string;
  email?: string;
  role: 'student' | 'teacher' | 'admin';
  class_id?: number;
  avatar?: string;
  gold?: number;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  
  login: (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },
  
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ token: null, user: null, isAuthenticated: false });
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
    }
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
