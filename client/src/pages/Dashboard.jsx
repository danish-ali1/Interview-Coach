import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { progressApi } from '../api/endpoints.js';
import { EmptyState, ErrorMessage, ScoreBadge, Spinner, formatDate } from '../components/ui.jsx';
import { useFetch } from '../hooks/useFetch.js';

const KIND_LABEL = { project: 'Project', technical: 'Technical', behavioral: 'Behavioral', scenario: 'Scenario' };

function Stat({ label, value }) {
  return (
    <div className="card stat">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const { data, error, loading, reload } = useFetch(() => progressApi.get(), []);

  if (loading && !data) return <Spinner label="Loading your progress…" />;
  if (error && !data) return <ErrorMessage error={error} onRetry={reload} />;

  const { totals, byTopic, weakestTopics, byKind, trend } = data;

  if (totals.answers === 0) {
    return (
      <>
        <h1>Dashboard</h1>
        <EmptyState title="No practice yet">
          Upload a resume and run your first mock interview. Your scores and weak spots will show up here.
        </EmptyState>
        <p className="center">
          <Link className="btn btn-primary" to="/resumes">Upload a resume</Link>
        </p>
      </>
    );
  }

  const trendData = trend.map((t, i) => ({ label: `#${i + 1}`, title: t.jobTitle, date: formatDate(t.completedAt), score: t.averageScore }));

  return (
    <>
      <div className="row between wrap">
        <h1>Dashboard</h1>
        <Link className="btn btn-primary" to="/interviews/new">New interview</Link>
      </div>

      <div className="grid-4">
        <Stat label="Interviews completed" value={totals.completedSessions} />
        <Stat label="Answers scored" value={totals.answers} />
        <Stat label="Average score" value={totals.averageScore != null ? `${totals.averageScore}/10` : '–'} />
        <Stat label="Best answer" value={totals.bestScore != null ? `${totals.bestScore}/10` : '–'} />
      </div>

      {weakestTopics.length > 0 && (
        <section className="card">
          <h2>Focus on these next</h2>
          <ul className="plain">
            {weakestTopics.map((t) => (
              <li key={t.topic} className="row between">
                <span>{t.topic} <span className="muted small">({t.answers} answer{t.answers === 1 ? '' : 's'})</span></span>
                <ScoreBadge score={t.averageScore} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>Score by topic</h2>
          <p className="muted small">Lowest first. Average over all your answers.</p>
          <div role="img" aria-label={`Bar chart of average score for ${byTopic.length} topics`} style={{ height: Math.max(180, byTopic.length * 34) }}>
            <ResponsiveContainer>
              <BarChart data={byTopic} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis type="number" domain={[0, 10]} stroke="var(--muted)" />
                <YAxis type="category" dataKey="topic" width={110} stroke="var(--muted)" />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
                <Bar dataKey="averageScore" name="Average" fill="var(--accent)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card">
          <h2>Progress over time</h2>
          <p className="muted small">Average score of each completed interview.</p>
          {trendData.length < 2 ? (
            <p className="muted">Complete one more interview to see your trend.</p>
          ) : (
            <div role="img" aria-label="Line chart of average interview score over time" style={{ height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={trendData} margin={{ left: 0, right: 16, top: 8 }}>
                  <CartesianGrid stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--muted)" />
                  <YAxis domain={[0, 10]} stroke="var(--muted)" />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                    formatter={(v) => [`${v}/10`, 'Average']}
                    labelFormatter={(_, p) => (p?.[0] ? `${p[0].payload.title} · ${p[0].payload.date}` : '')}
                  />
                  <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <h2>By question type</h2>
        <div className="grid-4">
          {byKind.map((k) => (
            <div key={k.kind}>
              <div className="muted small">{KIND_LABEL[k.kind] ?? k.kind}</div>
              <ScoreBadge score={k.averageScore} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
