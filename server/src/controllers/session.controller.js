export function createSessionController({ interviewService, progressService }) {
  return {
    async list(req, res) {
      res.json(await interviewService.list(req.user.id, req.valid.query));
    },

    async create(req, res) {
      res.status(201).json({ session: await interviewService.create(req.user.id, req.valid.body) });
    },

    async get(req, res) {
      res.json({ session: await interviewService.get(req.user.id, req.valid.params.id) });
    },

    async answer(req, res) {
      res.json(await interviewService.answer(req.user.id, req.valid.params.id, req.valid.body));
    },

    async complete(req, res) {
      res.json({ session: await interviewService.complete(req.user.id, req.valid.params.id) });
    },

    async remove(req, res) {
      await interviewService.remove(req.user.id, req.valid.params.id);
      res.status(204).end();
    },

    async progress(req, res) {
      res.json(await progressService.getProgress(req.user.id));
    },
  };
}
