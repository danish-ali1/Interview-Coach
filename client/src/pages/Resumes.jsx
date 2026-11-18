import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { resumesApi } from '../api/endpoints.js';
import { EmptyState, ErrorMessage, Spinner, formatDate } from '../components/ui.jsx';
import { useFetch } from '../hooks/useFetch.js';

const MAX_MB = 5;
const ACCEPT = '.pdf,.txt,.md,application/pdf,text/plain,text/markdown';

export default function Resumes() {
  const { data, error, loading, reload } = useFetch(() => resumesApi.list(), []);
  const fileInput = useRef(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [actionError, setActionError] = useState(null);

  async function onUpload(event) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file || uploading) return;

    // Cheap checks first so people get instant feedback. The server enforces all of these again.
    if (file.size > MAX_MB * 1024 * 1024) {
      setUploadError({ message: `That file is larger than ${MAX_MB} MB.` });
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      await resumesApi.upload(file, title.trim());
      setTitle('');
      fileInput.current.value = '';
      await reload();
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(resume) {
    if (!window.confirm(`Delete "${resume.title}"? This removes it and its stored passages.`)) return;
    setActionError(null);
    try {
      await resumesApi.remove(resume.id);
      await reload();
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <>
      <h1>Your resumes</h1>

      <form className="card" onSubmit={onUpload}>
        <h2>Upload a resume</h2>
        <p className="muted small">
          PDF, TXT or Markdown, up to {MAX_MB} MB. Text-based PDFs only (scanned images are not supported).
          Your contact details are removed before anything is sent to the AI provider, and the original file is not kept.
        </p>
        <ErrorMessage error={uploadError} />
        <div className="row wrap">
          <div className="field grow">
            <label htmlFor="file">File</label>
            <input id="file" ref={fileInput} type="file" accept={ACCEPT} required disabled={uploading} />
          </div>
          <div className="field grow">
            <label htmlFor="title">Label (optional)</label>
            <input id="title" value={title} maxLength={100} placeholder="e.g. Backend resume" onChange={(e) => setTitle(e.target.value)} disabled={uploading} />
          </div>
          <button className="btn btn-primary" disabled={uploading}>{uploading ? 'Processing…' : 'Upload'}</button>
        </div>
        {uploading && <p className="muted small">Reading and indexing your resume. This can take a few seconds.</p>}
      </form>

      <ErrorMessage error={actionError} />
      {loading && !data ? (
        <Spinner />
      ) : error && !data ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : data.resumes.length === 0 ? (
        <EmptyState title="No resumes yet">Upload one above to start practising.</EmptyState>
      ) : (
        <section aria-label="Uploaded resumes" className="stack">
          {data.resumes.map((r) => (
            <div key={r.id} className="card row between wrap">
              <div>
                <strong>{r.title}</strong>
                <div className="muted small">
                  {r.originalName} · {formatDate(r.createdAt)} · {r.chunkCount} passages
                </div>
                <div className="tags">{r.sections.map((s) => <span key={s} className="tag">{s}</span>)}</div>
              </div>
              <div className="row">
                <Link className="btn btn-small btn-primary" to={`/interviews/new?resume=${r.id}`}>Practise</Link>
                <button type="button" className="btn btn-small btn-danger" onClick={() => onDelete(r)}>Delete</button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
