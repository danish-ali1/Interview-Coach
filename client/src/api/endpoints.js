import { http } from './http.js';

const data = (promise) => promise.then((res) => res.data);

export const authApi = {
  register: (body) => data(http.post('/auth/register', body)),
  login: (body) => data(http.post('/auth/login', body)),
  logout: () => http.post('/auth/logout'),
  logoutAll: () => http.post('/auth/logout-all'),
};

export const resumesApi = {
  list: () => data(http.get('/resumes')),
  upload: (file, title) => {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    return data(http.post('/resumes', form));
  },
  remove: (id) => http.delete(`/resumes/${id}`),
};

export const sessionsApi = {
  list: (params) => data(http.get('/sessions', { params })),
  get: (id) => data(http.get(`/sessions/${id}`)),
  create: (body) => data(http.post('/sessions', body)),
  answer: (id, body) => data(http.post(`/sessions/${id}/answer`, body)),
  complete: (id) => data(http.post(`/sessions/${id}/complete`)),
  remove: (id) => http.delete(`/sessions/${id}`),
};

export const progressApi = {
  get: () => data(http.get('/progress')),
};
