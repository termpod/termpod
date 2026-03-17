import { useState } from 'react';
import { saveCustomRelayUrl, getPersistedCustomRelayUrl, resolveRelayUrl } from '../hooks/useAuth';

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (email: string, password: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

type View = 'login' | 'forgot-email' | 'forgot-code';

function isValidUrl(url: string): boolean {
  try {
    const normalized = url.trim().replace(/^wss?:\/\//, 'https://');
    new URL(normalized);
    return true;
  } catch {
    return false;
  }
}

function displayUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function getInitialCustomUrl(): string {
  const persisted = getPersistedCustomRelayUrl();
  if (persisted) {
    return persisted;
  }
  const resolved = resolveRelayUrl();
  return resolved === 'https://relay.termpod.dev' ? '' : resolved;
}

function getInitialShowCustom(): boolean {
  return !!getPersistedCustomRelayUrl();
}

export function LoginScreen({ onLogin, onSignup, loading, error }: LoginScreenProps) {
  const [isSignup, setIsSignup] = useState(false);
  const [view, setView] = useState<View>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);

  // Custom server state
  const [showCustomServer, setShowCustomServer] = useState(getInitialShowCustom);
  const [customRelayUrl, setCustomRelayUrl] = useState(getInitialCustomUrl);
  const [customUrlError, setCustomUrlError] = useState<string | null>(null);

  const applyAndGetRelayUrl = (): string | null => {
    const trimmed = customRelayUrl.trim();
    if (trimmed && !isValidUrl(trimmed)) {
      setCustomUrlError('Invalid URL format');
      return null;
    }
    saveCustomRelayUrl(trimmed);
    return resolveRelayUrl();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustomUrlError(null);

    if (applyAndGetRelayUrl() === null) {
      return;
    }

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

  const getRelayForForgot = (): string => {
    return resolveRelayUrl();
  };

  const handleForgotSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError(null);
    setForgotSuccess(null);

    try {
      const relayUrl = getRelayForForgot();
      const res = await fetch(`${relayUrl}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });

      if (res.status === 503) {
        setForgotError('Email service temporarily unavailable. Try again later.');
      } else if (res.status === 429) {
        setForgotError('Too many requests. Wait a minute and try again.');
      } else {
        setView('forgot-code');
        setForgotSuccess('Check your email for a 6-digit reset code.');
      }
    } catch {
      setForgotError('Network error. Check your connection.');
    }

    setForgotLoading(false);
  };

  const handleForgotSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError(null);

    try {
      const relayUrl = getRelayForForgot();
      const res = await fetch(`${relayUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail, code: resetCode, password: newPassword }),
      });

      const data = (await res.json()) as {
        error?: string;
        accessToken?: string;
        refreshToken?: string;
      };

      if (!res.ok) {
        setForgotError(data.error ?? 'Reset failed. Check your code and try again.');
      } else {
        setView('login');
        setEmail(forgotEmail);
        setPassword(newPassword);
        await onLogin(forgotEmail, newPassword);
      }
    } catch {
      setForgotError('Network error. Check your connection.');
    }

    setForgotLoading(false);
  };

  const resetForgotFlow = () => {
    setView('login');
    setForgotEmail('');
    setResetCode('');
    setNewPassword('');
    setForgotError(null);
    setForgotSuccess(null);
  };

  const customServerSection = (
    <div className="login-custom-server">
      <button
        type="button"
        className="login-custom-server-toggle"
        onClick={() => setShowCustomServer((s) => !s)}
      >
        <span
          className="login-custom-server-chevron"
          style={{ transform: showCustomServer ? 'rotate(90deg)' : 'none' }}
        >
          &#9656;
        </span>
        {showCustomServer && customRelayUrl ? displayUrl(customRelayUrl) : 'Custom server'}
      </button>
      {showCustomServer && (
        <div className="login-custom-server-body">
          <input
            type="text"
            placeholder="https://relay.example.com"
            value={customRelayUrl}
            onChange={(e) => {
              setCustomRelayUrl(e.target.value);
              setCustomUrlError(null);
            }}
            className={`login-input login-custom-server-input ${customUrlError ? 'login-input-error' : ''}`}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {customUrlError && <div className="login-custom-server-error">{customUrlError}</div>}
        </div>
      )}
    </div>
  );

  if (view === 'forgot-email') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-icon">&#9654;</div>
          <h1 className="login-title">TermPod</h1>
          <p className="login-subtitle">Reset your password</p>

          <form onSubmit={handleForgotSubmitEmail} className="login-form">
            <input
              type="email"
              placeholder="Email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              className={`login-input ${forgotError ? 'login-input-error' : ''}`}
              autoFocus
              required
            />

            {forgotError && <div className="login-error">{forgotError}</div>}

            <button
              type="submit"
              className={`login-button ${forgotLoading ? 'login-button-loading' : ''}`}
              disabled={forgotLoading}
            >
              Send Reset Code
              {forgotLoading && <span className="login-spinner" />}
            </button>
          </form>

          <button className="login-switch" onClick={resetForgotFlow}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  if (view === 'forgot-code') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-icon">&#9654;</div>
          <h1 className="login-title">TermPod</h1>
          <p className="login-subtitle">Enter your reset code</p>

          {forgotSuccess && (
            <div className="login-hint" style={{ textAlign: 'center', marginBottom: 8 }}>
              {forgotSuccess}
            </div>
          )}

          <form onSubmit={handleForgotSubmitCode} className="login-form">
            <input
              type="text"
              placeholder="6-digit code"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={`login-input ${forgotError ? 'login-input-error' : ''}`}
              inputMode="numeric"
              pattern="\d{6}"
              autoFocus
              required
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={`login-input ${forgotError ? 'login-input-error' : ''}`}
              minLength={8}
              required
            />
            <p className="login-hint">Minimum 8 characters</p>

            {forgotError && <div className="login-error">{forgotError}</div>}

            <button
              type="submit"
              className={`login-button ${forgotLoading ? 'login-button-loading' : ''}`}
              disabled={forgotLoading || resetCode.length !== 6 || newPassword.length < 8}
            >
              Reset Password
              {forgotLoading && <span className="login-spinner" />}
            </button>
          </form>

          <button className="login-switch" onClick={() => setView('forgot-email')}>
            Resend code
          </button>
          <button className="login-switch" onClick={resetForgotFlow} style={{ marginTop: 4 }}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

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
          {isSignup && <p className="login-hint">Minimum 8 characters</p>}

          {error && <div className="login-error">{error}</div>}

          <button
            type="submit"
            className={`login-button ${loading ? 'login-button-loading' : ''}`}
            disabled={loading}
          >
            {isSignup ? 'Create Account' : 'Sign In'}
            {loading && <span className="login-spinner" />}
          </button>
        </form>

        {!isSignup && (
          <button
            className="login-switch"
            onClick={() => {
              setForgotEmail(email);
              setView('forgot-email');
            }}
            style={{ marginBottom: 4 }}
          >
            Forgot password?
          </button>
        )}

        <button className="login-switch" onClick={() => setIsSignup(!isSignup)}>
          {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>

        {customServerSection}
      </div>
    </div>
  );
}
