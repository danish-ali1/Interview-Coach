import axios from 'axios';

/**
 * Session handling for the browser.
 *
 *  - The short-lived ACCESS token lives only in this module's memory: not in localStorage, where any
 *    XSS could read it. A page reload simply asks the server for a new one (see AuthContext).
 *  - The long-lived REFRESH token is an httpOnly cookie that JavaScript cannot touch; the browser
 *    sends it only to /api/auth/*.
 *  - When a request fails because the access token expired, we refresh ONCE and replay the request.
 *    Any number of parallel failures share a single refresh call: the server rotates refresh tokens,
 *    so several simultaneous refreshes would look like token theft.
 */

let accessToken = null;
let refreshPromise = null;
let onAuthLost = () => {};

export const setAccessToken = (token) => {
  accessToken = token;
};
export const setAuthLostHandler = (handler) => {
  onAuthLost = handler;
};

export class ApiError extends Error {
  constructor({ status = 0, code = 'NETWORK_ERROR', message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Field-level messages from a VALIDATION_ERROR, keyed by field name. */
  get fieldErrors() {
    const out = {};
    for (const item of Array.isArray(this.details) ? this.details : []) {
      if (item?.path && !out[item.path]) out[item.path] = item.message;
    }
    return out;
  }
}

function toApiError(error) {
  if (error instanceof ApiError) return error;
  const body = error.response?.data?.error;
  if (body) return new ApiError({ status: error.response.status, ...body });
  if (error.code === 'ECONNABORTED') {
    return new ApiError({ code: 'TIMEOUT', message: 'The request took too long. Please try again.' });
  }
  if (error.response) {
    return new ApiError({ status: error.response.status, code: 'HTTP_ERROR', message: 'Unexpected server response.' });
  }
  return new ApiError({ code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection and try again.' });
}

export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
  // AI calls (evaluating an answer, generating questions) can legitimately take a while.
  timeout: 90_000,
  // Required by the server on cookie-based endpoints; a cross-site form cannot send it.
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

const REFRESHABLE = new Set(['TOKEN_EXPIRED', 'INVALID_TOKEN', 'UNAUTHENTICATED']);

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const apiError = toApiError(error);
    const original = error.config;
    const isAuthEndpoint = /^\/auth\/(login|register|refresh|logout)/.test(original?.url ?? '');

    if (apiError.status === 401 && REFRESHABLE.has(apiError.code) && original && !original._retried && !isAuthEndpoint) {
      original._retried = true;
      try {
        await refreshSession();
        return http(original); // the request interceptor attaches the new token
      } catch {
        throw apiError; // refreshSession has already signed the user out
      }
    }
    throw apiError;
  },
);

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession() {
  refreshPromise ??= http
    .post('/auth/refresh')
    .then(({ data }) => {
      accessToken = data.accessToken;
      return data;
    })
    .catch((err) => {
      accessToken = null;
      onAuthLost(err);
      throw err;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}
