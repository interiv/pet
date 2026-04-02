const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

const api = {
  baseUrl: BASE_URL,

  auth: {
    register: (data) => axios.post(`${BASE_URL}/auth/register`, data),
    login: (data) => axios.post(`${BASE_URL}/auth/login`, data),
  },

  users: {
    getById: (id, token) => axios.get(`${BASE_URL}/users/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  pets: {
    getAll: () => axios.get(`${BASE_URL}/pets/all`),
    getSpecies: () => axios.get(`${BASE_URL}/pets/species`),
    getMyPet: (token) => axios.get(`${BASE_URL}/pets/my-pet`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    create: (data, token) => axios.post(`${BASE_URL}/pets/create`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  items: {
    getAll: (token) => axios.get(`${BASE_URL}/items`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    buy: (data, token) => axios.post(`${BASE_URL}/items/buy`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    getMyItems: (token) => axios.get(`${BASE_URL}/items/my-items`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  friends: {
    getList: (token) => axios.get(`${BASE_URL}/friends/list`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    add: (data, token) => axios.post(`${BASE_URL}/friends/add`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    visit: (data, token) => axios.post(`${BASE_URL}/friends/visit`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    gift: (data, token) => axios.post(`${BASE_URL}/friends/gift`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    battle: (data, token) => axios.post(`${BASE_URL}/friends/friend-battle`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  battles: {
    start: (data, token) => axios.post(`${BASE_URL}/battles/start`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  equipment: {
    getMyEquipment: (token) => axios.get(`${BASE_URL}/equipment/my-equipment`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    equip: (data, token) => axios.post(`${BASE_URL}/equipment/equip`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  achievements: {
    getList: (token) => axios.get(`${BASE_URL}/achievements/list`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    getStatus: (token) => axios.get(`${BASE_URL}/achievements/status`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },

  assignments: {
    getAll: (token) => axios.get(`${BASE_URL}/assignments`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    create: (data, token) => axios.post(`${BASE_URL}/assignments`, data, {
      headers: { Authorization: `Bearer ${token}` }
    }),
  },
};

module.exports = api;