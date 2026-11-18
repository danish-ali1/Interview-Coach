# Interview Coach

Upload your resume, paste a job description, and practise a mock interview. Questions are written from **your own resume** using retrieval-augmented generation (RAG). Each answer is scored against a rubric, and a dashboard tracks your weak topics over time.

**Stack:** MongoDB · Express (Node 22) · React 19 (Vite) · Google Gemini (embeddings + generation) · JWT access tokens with rotating refresh tokens.

```
Browser (React) ──/api──▶ nginx ──▶ Express API ──▶ MongoDB
                                        │            (users, resumes, chunks + embeddings, interviews)
                                        └──▶ Gemini API (embeddings, question/evaluation generation)
```

## How RAG works here

| Step | What happens | Code |
|---|---|---|
| Parse | Extract text from PDF/TXT/MD (type checked by magic bytes, page and size capped) | `services/resume.parser.js` |
| Chunk | Split **by resume section** (experience, projects, skills…), then pack paragraphs. Emails and phone numbers are removed before anything leaves your server | `services/chunker.js` |
| Embed | Each chunk is embedded as `RETRIEVAL_DOCUMENT` with its section name in the text | `services/rag.service.js` |
| Retrieve | For each question the focus (a job requirement + question type) is embedded as `RETRIEVAL_QUERY` and the top‑4 chunks of **that user's resume** are fetched | `services/vectorStore/*` |
| Generate | Retrieved chunks + job requirements go into the prompt; the model returns validated JSON | `services/prompts.js` |
| Evaluate | The model scores four rubric items; **the final score is computed in code** from weighted rubric values (accuracy 35%, relevance 25%, depth 25%, communication 15%), not taken from a single number the model invents | `computeScore()` |

### pgvector or something else?

Retrieval sits behind a three-method interface (`insertMany`, `search`, `deleteByResume`), and two implementations ship:

* **`VECTOR_STORE=local` (default)** stores embeddings in MongoDB and ranks them in the app. Search is scoped to one resume of one user (a few dozen chunks), so this is exact and instant, needs no index and no extra database. It works on any MongoDB, including a plain Docker container.
* **`VECTOR_STORE=atlas`** uses MongoDB Atlas `$vectorSearch` (approximate nearest-neighbour). Create this Atlas Search index on the `resumechunks` collection, with `numDimensions` equal to `EMBEDDING_DIMENSIONS` (default 768):
  ```json
  { "fields": [
      { "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "dotProduct" },
      { "type": "filter", "path": "user" },
      { "type": "filter", "path": "resume" } ] }
  ```
* **pgvector** would be a third file next to `local.js` implementing the same three methods. It was not chosen here because per-user search over ~50 chunks does not justify running a second database; it becomes worthwhile for a shared corpus with many thousands of documents.

Changing `GEMINI_EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS` makes old vectors incompatible; re-upload resumes after changing them.

## Authentication

* **Access token**: JWT (HS256, 15 min). The browser keeps it **in memory only**.
* **Refresh token**: 384-bit random value in an `httpOnly`, `SameSite=Strict`, `Secure` (production) cookie scoped to `/api/auth`. Only its **SHA‑256 hash** is stored.
* **Rotation**: every refresh consumes the old token and issues a new one. The consume step is a single atomic `findOneAndUpdate`, so of two simultaneous requests only one wins.
* **Reuse detection**: presenting an already-used token revokes the entire login (token family).
* **Two-tab leeway**: a token rotated less than `REFRESH_REUSE_LEEWAY_SECONDS` (10) ago is accepted again, so two tabs refreshing together do not sign the user out. Trade-off: a stolen token replayed inside that window is not detected. Set it to `0` for strict behaviour.
* **Lifetimes**: 7-day sliding window, hard 30-day cap per login. MongoDB's TTL index deletes expired rows.
* **Also**: bcrypt (12 rounds), equal-time login for unknown emails, no account enumeration, `X-Requested-With` required on cookie endpoints (CSRF defence in depth), per-IP limits on auth, per-user limits on AI and upload endpoints, logout and logout-all.
* **Browser side** (`client/src/api/http.js`): on `TOKEN_EXPIRED` the client refreshes **once** (parallel failures share one request) and replays the request; a failed refresh signs the user out.

## Run it

**Docker (needs Docker with Compose):**
```bash
cp .env.example .env        # set JWT_ACCESS_SECRET and GEMINI_API_KEY
docker compose up --build   # http://localhost:8080
```

**Without Docker:**
```bash
# terminal 1: API (needs a MongoDB, e.g. docker run -p 27017:27017 mongo:7)
cd server && cp .env.example .env   # fill in GEMINI_API_KEY and JWT_ACCESS_SECRET
npm install && npm run dev
# terminal 2: web app
cd client && npm install && npm run dev   # http://localhost:5173 (proxies /api to :5000)
```
Get a free Gemini key at https://aistudio.google.com/apikey.

## API

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register`, `/login` | – | Create account / sign in. Returns `{ user, accessToken }` and sets the refresh cookie |
| `POST /api/auth/refresh` | cookie | Rotate refresh token, get a new access token |
| `POST /api/auth/logout`, `/logout-all` | cookie / Bearer | End this login / every login |
| `GET /api/auth/me` | Bearer | Current user |
| `GET/POST /api/resumes`, `GET/DELETE /api/resumes/:id` | Bearer | List, upload (multipart field `file`), delete |
| `POST /api/sessions` | Bearer | Start an interview `{ resumeId, jobTitle, company?, jobDescription, numQuestions, difficulty }` |
| `GET /api/sessions`, `GET/DELETE /api/sessions/:id` | Bearer | History (paginated), detail, delete |
| `POST /api/sessions/:id/answer` | Bearer | Submit `{ questionId, answer }` → evaluation + next question |
| `POST /api/sessions/:id/complete` | Bearer | Finish early |
| `GET /api/progress` | Bearer | Totals, per-topic and per-type averages, trend |
| `GET /healthz`, `/readyz` | – | Liveness / readiness (database connected) |

Every error has the same shape: `{ "error": { "code", "message", "requestId", "details?" } }`.

## Tests

```bash
cd server
npm test                    # 109 unit tests, no database or network needed
npm run test:integration    # API tests against a real MongoDB
```
The integration suite uses `mongodb-memory-server` (downloads a MongoDB binary once) or your own instance via `TEST_MONGODB_URI=mongodb://127.0.0.1:27017`. The AI provider is always faked.

What the unit tests cover: config validation, chunking, PDF/TXT parsing (real PDFs from four generators, including a regression test for the cross-parse bug in the `pdf-parse` package), JWT checks, refresh rotation / reuse detection / lifetime cap / the two-tab race (with a fake model layer), Gemini client retries and error mapping, the RAG pipeline (grounding, prompt-injection fencing, schema-validation retries, rubric scoring), the HTTP layer, CORS, CSRF guard and error mapping.

## Before going to production

* Terminate **TLS** in front of the app and keep `COOKIE_SECURE=true`. Set `TRUST_PROXY` to the number of proxies in front of the API.
* Keep secrets in a secret manager. Rotating `JWT_ACCESS_SECRET` signs everyone out of access tokens only; refresh tokens keep working.
* Use a managed MongoDB with backups. With `MONGO_AUTO_INDEX=false`, run `npm run db:indexes` on deploy.
* Rate limits use an in-memory store, so they are per instance. With more than one API instance, add a shared store (e.g. Redis) to `express-rate-limit`.
* **Privacy:** resume text (minus emails and phone numbers) is sent to Google's Gemini API. Check Google's current terms for how free-tier prompts may be used, and use a paid key before handling other people's data. The original file is never stored.
* Add what this project does not include: email verification, password reset, monitoring/alerting, CI.

## Known limitations

* If the server dies between saving an answer and saving its evaluation, that question cannot be re-answered. The interview can still be finished or deleted from the UI.
* Text-based PDFs only (no OCR); the first 10 pages and 30,000 characters are used.
* Free Gemini quotas are small; a busy instance will see `AI_RATE_LIMITED` responses (the UI shows a friendly message).


