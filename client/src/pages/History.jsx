import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sessionsApi } from '../api/endpoints.js';
import { EmptyState, ErrorMessage, ScoreBadge, Spinner, formatDate } from '../components/ui.jsx';
import { useFetch } from '../hooks/useFetch.js';

export default function History() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch(() => sessionsApi.list({ page, limit: 10 }), [page]);
  const [actionError, setActionError] = useState(null);

  async function onDelete(item) {
    if (!window.confirm(`Delete the "${item.jobTitle}" interview?`)) return;
    setActionError(null);
    try {
      await sessionsApi.remove(item.id);
      // Deleting the last item of a page would leave an empty page; step back instead.
      if (data.items.length === 1 && page > 1) setPage(page - 1);
      else await reload();
    } catch (err) {
      setActionError(err);
    }
  }

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorMessage error={error} onRetry={reload} />;

  return (
    <>
      <div className="row between wrap">
        <h1>Interview history</h1>
        <Link className="btn btn-primary" to="/interviews/new">New interview</Link>
      </div>
      <ErrorMessage error={actionError} />

      {data.items.length === 0 ? (
        <EmptyState title="No interviews yet">Start one to see it here.</EmptyState>
      ) : (
        <div className="stack">
          {data.items.map((s) => (
            <div key={s.id} className="card row between wrap">
              <div>
                <Link to={`/interviews/${s.id}`}><strong>{s.jobTitle}</strong></Link>
                {s.company && <span className="muted"> · {s.company}</span>}
                <div className="muted small">
                  {formatDate(s.createdAt)} · {s.answeredCount}/{s.totalQuestions} answered · {s.resumeTitle ?? 'Deleted resume'}
                </div>
              </div>
              <div className="row">
                {s.status === 'completed' ? <ScoreBadge score={s.averageScore} /> : <span className="badge">In progress</span>}
                <Link className="btn btn-small" to={`/interviews/${s.id}`}>{s.status === 'completed' ? 'View' : 'Continue'}</Link>
                <button type="button" className="btn btn-small btn-danger" onClick={() => onDelete(s)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.totalPages > 1 && (
        <nav className="row center" aria-label="Pagination">
          <button className="btn btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted small">Page {data.page} of {data.totalPages}</span>
          <button className="btn btn-small" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </nav>
      )}
    </>
  );
}
