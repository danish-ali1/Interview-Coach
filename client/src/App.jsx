import { Component, Suspense, lazy } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { ProtectedLayout, PublicOnly } from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import History from './pages/History.jsx';
import Interview from './pages/Interview.jsx';
import NewInterview from './pages/NewInterview.jsx';
import Resumes from './pages/Resumes.jsx';

// The dashboard pulls in the charting library (most of the bundle), so load it on demand.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));

/** Catches render errors so one broken page shows a message instead of a blank screen. */
class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('UI error:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h1>Something went wrong</h1>
          <p className="muted">The page hit an unexpected problem. Reloading usually fixes it.</p>
          <button className="btn btn-primary" onClick={() => window.location.assign('/')}>Reload</button>
        </div>
      </div>
    );
  }
}

function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="card auth-card center">
        <h1>Page not found</h1>
        <p className="muted">That page does not exist.</p>
        <Link className="btn btn-primary" to="/">Go to dashboard</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
        <Route element={<ProtectedLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="resumes" element={<Resumes />} />
          <Route path="interviews" element={<History />} />
          <Route path="interviews/new" element={<NewInterview />} />
          <Route path="interviews/:id" element={<Interview />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
