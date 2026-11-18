export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Shows an ApiError. Includes the request id so a user can quote it when reporting a problem. */
export function ErrorMessage({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <div>
        <strong>{error.message || 'Something went wrong.'}</strong>
        {error.requestId && error.status >= 500 && <div className="muted small">Reference: {error.requestId}</div>}
      </div>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p className="muted">{children}</p>
    </div>
  );
}

export const scoreTone = (score) => (score >= 7.5 ? 'good' : score >= 5 ? 'ok' : 'low');
export const scoreWord = (score) => (score >= 7.5 ? 'Strong' : score >= 5 ? 'Solid' : 'Needs work');

/** Colour AND text, so the meaning never depends on colour alone. */
export function ScoreBadge({ score }) {
  if (score == null) return <span className="badge">No score</span>;
  return (
    <span className={`badge badge-${scoreTone(score)}`}>
      {Number(score).toFixed(1)}/10 · {scoreWord(score)}
    </span>
  );
}

export function RubricBars({ rubric }) {
  const labels = {
    relevance: 'Relevance',
    technicalAccuracy: 'Technical accuracy',
    depth: 'Depth',
    communication: 'Communication',
  };
  return (
    <dl className="rubric">
      {Object.entries(labels).map(([key, label]) => (
        <div key={key} className="rubric-row">
          <dt>{label}</dt>
          <dd>
            <div className="bar" aria-hidden="true">
              <div className={`bar-fill tone-${scoreTone(rubric?.[key] ?? 0)}`} style={{ width: `${(rubric?.[key] ?? 0) * 10}%` }} />
            </div>
            <span>{(rubric?.[key] ?? 0).toFixed(1)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function EvaluationCard({ evaluation }) {
  return (
    <section className="card eval" aria-label="Feedback on your answer">
      <div className="row between">
        <h3>Feedback</h3>
        <ScoreBadge score={evaluation.score} />
      </div>
      <RubricBars rubric={evaluation.rubric} />
      <p>{evaluation.feedback}</p>
      <div className="grid-2">
        <div>
          <h4>What worked</h4>
          <ul>{evaluation.strengths.length ? evaluation.strengths.map((s) => <li key={s}>{s}</li>) : <li className="muted">Nothing specific noted.</li>}</ul>
        </div>
        <div>
          <h4>What was missing</h4>
          <ul>{evaluation.gaps.length ? evaluation.gaps.map((g) => <li key={g}>{g}</li>) : <li className="muted">Nothing specific noted.</li>}</ul>
        </div>
      </div>
      <details>
        <summary>See a stronger answer</summary>
        <p className="quote">{evaluation.improvedAnswer}</p>
      </details>
    </section>
  );
}

export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
