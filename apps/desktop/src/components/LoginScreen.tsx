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

const TerminalIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const EmailIcon = () => (
  <svg
    className="login-input-icon"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="1.5" y="3" width="13" height="10" rx="2" />
    <path d="M1.5 5.5L8 9.5L14.5 5.5" />
  </svg>
);

const LockIcon = () => (
  <svg
    className="login-input-icon"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="7" width="10" height="7" rx="2" />
    <path d="M5 7V5a3 3 0 0 1 6 0v2" />
  </svg>
);

const KeyIcon = () => (
  <svg
    className="login-input-icon"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="5.5" cy="5.5" r="3" />
    <path d="M8 8l6 6M11 11l2 2M12 10l2 2" />
  </svg>
);

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

  const logo = (
    <div className="login-logo">
      <TerminalIcon />
    </div>
  );

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
        {!showCustomServer && customRelayUrl ? displayUrl(customRelayUrl) : 'Custom server'}
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
            className={`login-input login-input-plain login-custom-server-input ${customUrlError ? 'login-input-error' : ''}`}
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
          {logo}
          <h1 className="login-title">Reset password</h1>
          <p className="login-subtitle">Enter your email to receive a reset code</p>

          <form onSubmit={handleForgotSubmitEmail} className="login-form">
            <div className="login-input-group">
              <EmailIcon />
              <input
                type="email"
                placeholder="Email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className={`login-input ${forgotError ? 'login-input-error' : ''}`}
                autoFocus
                required
              />
            </div>

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
          {logo}
          <h1 className="login-title">Enter reset code</h1>
          <p className="login-subtitle">Check your email for a 6-digit code</p>

          {forgotSuccess && (
            <div className="login-hint" style={{ textAlign: 'center' }}>
              {forgotSuccess}
            </div>
          )}

          <form onSubmit={handleForgotSubmitCode} className="login-form">
            <div className="login-input-group">
              <KeyIcon />
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
            </div>
            <div className="login-input-group">
              <LockIcon />
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`login-input ${forgotError ? 'login-input-error' : ''}`}
                minLength={8}
                required
              />
            </div>
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

          <div className="login-links">
            <button className="login-switch" onClick={() => setView('forgot-email')}>
              Resend code
            </button>
            <button className="login-switch" onClick={resetForgotFlow}>
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        {logo}
        <h1 className="login-title">TermPod</h1>
        <p className="login-subtitle">
          {isSignup ? 'Create your account' : 'Sign in to your account'}
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-input-group">
            <EmailIcon />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`login-input ${error ? 'login-input-error' : ''}`}
              autoFocus
              required
            />
          </div>
          <div className="login-input-group">
            <LockIcon />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`login-input ${error ? 'login-input-error' : ''}`}
              minLength={8}
              required
            />
          </div>
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

        <div className="login-links">
          {!isSignup && (
            <button
              className="login-switch"
              onClick={() => {
                setForgotEmail(email);
                setView('forgot-email');
              }}
            >
              Forgot password?
            </button>
          )}

          <button
            className="login-switch login-switch-primary"
            onClick={() => setIsSignup(!isSignup)}
          >
            {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>

        {customServerSection}
      </div>
    </div>
  );
}
