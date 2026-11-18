export const REFRESH_COOKIE = 'ic_refresh';

/**
 * The refresh token only ever travels in this cookie:
 *  - httpOnly: JavaScript (and therefore XSS) cannot read it
 *  - sameSite=strict + path=/api/auth: the browser sends it only to the auth endpoints, same-site only
 *  - secure: HTTPS only in production
 */
export function createCookieHelpers({ secure }) {
  const base = { httpOnly: true, secure, sameSite: 'strict', path: '/api/auth' };

  return {
    set(res, token, expiresAt) {
      res.cookie(REFRESH_COOKIE, token, { ...base, expires: expiresAt });
    },
    clear(res) {
      res.clearCookie(REFRESH_COOKIE, base);
    },
    read(req) {
      return req.cookies?.[REFRESH_COOKIE];
    },
  };
}
