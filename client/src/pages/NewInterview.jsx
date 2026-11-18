import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resumesApi, sessionsApi } from '../api/endpoints.js';
import { EmptyState, ErrorMessage, Spinner } from '../components/ui.jsx';
import { useFetch } from '../hooks/useFetch.js';

const MIN_JD = 40;
const MAX_JD = 8000;

export default function NewInterview() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data, error, loading, reload } = useFetch(() => resumesApi.list(), []);
  const [form, setForm] = useState({
    resumeId: params.get('resume') ?? '',
    jobTitle: '',
    company: '',
    jobDescription: '',
    numQuestions: 5,
    difficulty: 'mid',
  });
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const set = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorMessage error={error} onRetry={reload} />;

  if (data.resumes.length === 0) {
    return (
      <>
        <h1>New interview</h1>
        <EmptyState title="Upload a resume first">Questions are written from your resume, so we need one to begin.</EmptyState>
        <p className="center"><Link className="btn btn-primary" to="/resumes">Upload a resume</Link></p>
      </>
    );
  }

  const resumeId = form.resumeId || data.resumes[0].id;
  const jdLength = form.jobDescription.trim().length;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const { session } = await sessionsApi.create({
        ...form,
        resumeId,
        numQuestions: Number(form.numQuestions),
        company: form.company.trim() || undefined,
      });
      navigate(`/interviews/${session.id}`, { replace: true });
    } catch (err) {
      setSubmitError(err);
      setBusy(false);
    }
  }

  const fieldError = submitError?.fieldErrors ?? {};

  return (
    <>
      <h1>New interview</h1>
      <form className="card stack" onSubmit={onSubmit} noValidate>
        <ErrorMessage error={submitError} />

        <div className="field">
          <label htmlFor="resumeId">Resume</label>
          <select id="resumeId" name="resumeId" value={resumeId} onChange={set} disabled={busy}>
            {data.resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="jobTitle">Job title</label>
            <input id="jobTitle" name="jobTitle" required maxLength={120} placeholder="Backend Developer" value={form.jobTitle} onChange={set} disabled={busy} />
            {fieldError.jobTitle && <div className="field-error">{fieldError.jobTitle}</div>}
          </div>
          <div className="field">
            <label htmlFor="company">Company (optional)</label>
            <input id="company" name="company" maxLength={120} value={form.company} onChange={set} disabled={busy} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="jobDescription">Job description</label>
          <textarea id="jobDescription" name="jobDescription" rows={9} required maxLength={MAX_JD} placeholder="Paste the job description here…" value={form.jobDescription} onChange={set} disabled={busy} />
          <div className="row between small muted">
            <span>{jdLength < MIN_JD ? `At least ${MIN_JD} characters` : 'Looks good'}</span>
            <span>{jdLength}/{MAX_JD}</span>
          </div>
          {fieldError.jobDescription && <div className="field-error">{fieldError.jobDescription}</div>}
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="difficulty">Difficulty</label>
            <select id="difficulty" name="difficulty" value={form.difficulty} onChange={set} disabled={busy}>
              <option value="junior">Junior</option>
              <option value="mid">Mid-level</option>
              <option value="senior">Senior</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="numQuestions">Number of questions</label>
            <select id="numQuestions" name="numQuestions" value={form.numQuestions} onChange={set} disabled={busy}>
              {[3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <button className="btn btn-primary" disabled={busy || jdLength < MIN_JD || form.jobTitle.trim().length < 2}>
          {busy ? 'Preparing your first question…' : 'Start interview'}
        </button>
        {busy && <p className="muted small">Reading the job description and your resume. This usually takes 5 to 15 seconds.</p>}
      </form>
    </>
  );
}
