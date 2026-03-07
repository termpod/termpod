import { useState } from 'react';

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (email: string, password: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function LoginScreen({ onLogin, onSignup, loading, error }: LoginScreenProps) {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (isSignup) {
        await onSignup(email, password);
      } else {
        await onLogin(email, password);
      }
    } catch {
      // Error is handled by the hook
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">&#9654;</div>
        <h1 className="login-title">TermPod</h1>
        <p className="login-subtitle">
          {isSignup ? 'Create your account' : 'Sign in to your account'}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`login-input ${error ? 'login-input-error' : ''}`}
            autoFocus
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`login-input ${error ? 'login-input-error' : ''}`}
            minLength={8}
            required
          />
          {isSignup && (
            <p className="login-hint">Minimum 8 characters</p>
          )}

          {error && <div className="login-error">{error}</div>}

          <button
            type="submit"
            className={`login-button ${loading ? 'login-button-loading' : ''}`}
            disabled={loading}
          >
            {isSignup ? 'Create Account' : 'Sign In'}
            {loading && (
              <span className="login-spinner" />
            )}
          </button>
        </form>

        <button
          className="login-switch"
          onClick={() => setIsSignup(!isSignup)}
        >
          {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>
      </div>
    </div>
  );
}
