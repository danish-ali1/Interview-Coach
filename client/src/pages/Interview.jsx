import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { sessionsApi } from '../api/endpoints.js';
import { ErrorMessage, EvaluationCard, ScoreBadge, Spinner } from '../components/ui.jsx';
import { useFetch } from '../hooks/useFetch.js';

const KIND_LABEL = { project: 'Project deep-dive', technical: 'Technical', behavioral: 'Behavioral', scenario: 'Scenario' };
const MAX_ANSWER = 4000;

function Results({ session }) {
  return (
    <>
      <div className="row between wrap">
        <div>
          <h1>Interview results</h1>
          <p className="muted">{session.jobTitle}{session.company ? ` at ${session.company}` : ''}</p>
        </div>
        <ScoreBadge score={session.averageScore} />
      </div>

      {session.summary && (
        <section className="card stack">
          <h2>Debrief</h2>
          <p>{session.summary.overall}</p>
          <div className="grid-3">
            <div><h4>Strengths</h4><ul>{session.summary.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div>
            <div><h4>To improve</h4><ul>{session.summary.improvements.map((s) => <li key={s}>{s}</li>)}</ul></div>
            <div><h4>Next steps</h4><ul>{session.summary.nextSteps.map((s) => <li key={s}>{s}</li>)}</ul></div>
          </div>
        </section>
      )}

      <h2>Question by question</h2>
      {session.questions.map((q, i) => (
        <details key={q.id} className="card">
          <summary>
            <span className="muted">Q{i + 1} · {q.topic}</span> {q.text}
            {q.evaluation && <span className="summary-score"><ScoreBadge score={q.evaluation.score} /></span>}
          </summary>
          {q.answer ? (
            <>
              <h4>Your answer</h4>
              <p className="quote">{q.answer}</p>
              {q.evaluation ? <EvaluationCard evaluation={q.evaluation} /> : <p className="muted">This answer was not evaluated.</p>}
            </>
          ) : (
            <p className="muted">You skipped this question.</p>
          )}
        </details>
      ))}

      <p className="row">
        <Link className="btn btn-primary" to="/interviews/new">Practise again</Link>
        <Link className="btn" to="/">Back to dashboard</Link>
      </p>
    </>
  );
}

export default function Interview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useFetch(() => sessionsApi.get(id), [id]);

  const [session, setSession] = useState(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // Feedback for the question just answered, kept on screen until the user moves on.
  const [justAnswered, setJustAnswered] = useState(null);

  useEffect(() => {
    if (data) setSession(data.session);
  }, [data]);

  if ((loading && !data) || !session) {
    return error ? <ErrorMessage error={error} onRetry={reload} /> : <Spinner label="Loading interview…" />;
  }

  if (session.status === 'completed' && !justAnswered) return <Results session={session} />;

  const current = session.questions.find((q) => !q.answer);
  const stuck = session.questions.find((q) => q.answer && !q.evaluation); // saved but never evaluated (server crashed mid-request)
  const answeredCount = session.questions.filter((q) => q.evaluation).length;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy || !current) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await sessionsApi.answer(session.id, { questionId: current.id, answer: answer.trim() });
      setSession(result.session);
      setJustAnswered({ question: current, evaluation: result.evaluation, finished: result.session.status === 'completed' });
      setAnswer('');
    } catch (err) {
      setSubmitError(err); // the draft stays in the box so nothing the user typed is lost
    } finally {
      setBusy(false);
    }
  }

  async function onFinishEarly() {
    if (!window.confirm('Finish now? Unanswered questions will be skipped.')) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const { session: done } = await sessionsApi.complete(session.id);
      setSession(done);
      setJustAnswered(null);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm('Delete this interview?')) return;
    try {
      await sessionsApi.remove(session.id);
      navigate('/interviews', { replace: true });
    } catch (err) {
      setSubmitError(err);
    }
  }

  // Showing feedback for the answer just submitted.
  if (justAnswered) {
    return (
      <>
        <p className="muted">Question {answeredCount} of {session.totalQuestions} · {justAnswered.question.topic}</p>
        <h1 className="question">{justAnswered.question.text}</h1>
        <EvaluationCard evaluation={justAnswered.evaluation} />
        <p>
          <button className="btn btn-primary" onClick={() => setJustAnswered(null)}>
            {justAnswered.finished ? 'See results' : 'Next question'}
          </button>
        </p>
      </>
    );
  }

  if (!current) {
    return (
      <>
        <h1>Almost done</h1>
        <p className="muted">
          {stuck ? 'One answer was saved but could not be evaluated. ' : ''}You can finish the interview to see your results.
        </p>
        <ErrorMessage error={submitError} />
        <p className="row">
          <button className="btn btn-primary" onClick={onFinishEarly} disabled={busy || answeredCount === 0}>Finish and see results</button>
          <button className="btn btn-danger" onClick={onDelete}>Delete interview</button>
        </p>
      </>
    );
  }

  const number = session.questions.findIndex((q) => q.id === current.id) + 1;

  return (
    <>
      <div className="row between wrap">
        <p className="muted">
          {session.jobTitle}{session.company ? ` · ${session.company}` : ''} · Question {number} of {session.totalQuestions}
        </p>
        <span className="tag">{KIND_LABEL[current.kind] ?? current.kind}</span>
      </div>
      <progress className="progress" value={answeredCount} max={session.totalQuestions} aria-label="Interview progress" />

      <h1 className="question">{current.text}</h1>

      {current.sources.length > 0 && (
        <details className="sources">
          <summary>Based on these parts of your resume</summary>
          {current.sources.map((s, i) => (
            <blockquote key={i}>
              <span className="tag">{s.section}</span> {s.snippet}
            </blockquote>
          ))}
        </details>
      )}

      <form className="stack" onSubmit={onSubmit}>
        <ErrorMessage error={submitError} />
        <div className="field">
          <label htmlFor="answer">Your answer</label>
          <textarea
            id="answer"
            rows={9}
            value={answer}
            maxLength={MAX_ANSWER}
            disabled={busy}
            placeholder="Answer as you would in a real interview. Use a concrete example and say what the result was."
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="row between small muted">
            <span>{answer.trim().length < 10 ? 'Write at least a couple of sentences' : ' '}</span>
            <span>{answer.length}/{MAX_ANSWER}</span>
          </div>
        </div>
        <div className="row wrap">
          <button className="btn btn-primary" disabled={busy || answer.trim().length < 10}>{busy ? 'Evaluating your answer…' : 'Submit answer'}</button>
          <button type="button" className="btn" disabled={busy || answeredCount === 0} onClick={onFinishEarly}>Finish early</button>
        </div>
        {busy && <p className="muted small">Scoring your answer against your resume and the job. This usually takes 10 to 25 seconds.</p>}
      </form>
    </>
  );
}
