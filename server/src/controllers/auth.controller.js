export function createAuthController({ authService, cookies }) {
  const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

  // The refresh token goes into the cookie only; the JSON body carries the access token.
  const respondWithSession = (res, session, status = 200) => {
    cookies.set(res, session.refreshToken, session.refreshExpiresAt);
    res.status(status).json({
      user: session.user,
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    });
  };

  return {
    async register(req, res) {
      respondWithSession(res, await authService.register(req.valid.body, meta(req)), 201);
    },

    async login(req, res) {
      respondWithSession(res, await authService.login(req.valid.body, meta(req)));
    },

    async refresh(req, res) {
      let session;
      try {
        session = await authService.refresh(cookies.read(req), meta(req));
      } catch (err) {
        cookies.clear(res); // a dead cookie is useless; drop it
        throw err;
      }
      respondWithSession(res, session);
    },

    async logout(req, res) {
      await authService.logout(cookies.read(req));
      cookies.clear(res);
      res.status(204).end();
    },

    async logoutAll(req, res) {
      await authService.logoutAll(req.user.id);
      cookies.clear(res);
      res.status(204).end();
    },

    async me(req, res) {
      res.json({ user: await authService.getUser(req.user.id) });
    },
  };
}
