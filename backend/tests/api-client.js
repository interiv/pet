const axios = require('axios');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000/api';

const api = {
  baseUrl: BASE_URL,

  setBaseUrl: (url) => {
    api.baseUrl = url;
  },

  auth: {
    register: (data) => axios.post(`${api.baseUrl}/auth/register`, data),
    login: (data) => axios.post(`${api.baseUrl}/auth/login`, data),
  },

  users: {
    getById: (id, token) => axios.get(`${api.baseUrl}/users/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  pets: {
    getAll: () => axios.get(`${api.baseUrl}/pets/all`),
    getSpecies: () => axios.get(`${api.baseUrl}/pets/species`),
    getMyPet: (token) => axios.get(`${api.baseUrl}/pets/my-pet`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    create: (data, token) => axios.post(`${api.baseUrl}/pets/create`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  items: {
    getAll: (token) => axios.get(`${api.baseUrl}/items`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    buy: (data, token) => axios.post(`${api.baseUrl}/items/buy`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    getMyItems: (token) => axios.get(`${api.baseUrl}/items/my-items`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  friends: {
    getList: (token) => axios.get(`${api.baseUrl}/friends/list`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    add: (data, token) => axios.post(`${api.baseUrl}/friends/add`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    visit: (data, token) => axios.post(`${api.baseUrl}/friends/visit`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    gift: (data, token) => axios.post(`${api.baseUrl}/friends/gift`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    battle: (data, token) => axios.post(`${api.baseUrl}/friends/friend-battle`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  battles: {
    start: (data, token) => axios.post(`${api.baseUrl}/battles/start`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  equipment: {
    getMyEquipment: (token) => axios.get(`${api.baseUrl}/equipment/my-equipment`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    equip: (data, token) => axios.post(`${api.baseUrl}/equipment/equip`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  achievements: {
    getList: (token) => axios.get(`${api.baseUrl}/achievements/list`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    getStatus: (token) => axios.get(`${api.baseUrl}/achievements/status`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  assignments: {
    getAll: (token) => axios.get(`${api.baseUrl}/assignments`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    create: (data, token) => axios.post(`${api.baseUrl}/assignments`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  health: {
    check: () => axios.get(`${api.baseUrl}/health`),
  },
};

module.exports = api;