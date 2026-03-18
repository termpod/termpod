import { useState } from 'react';
import { THEMES, isLightColor } from '../hooks/useSettings';
import type { Settings } from '../hooks/useSettings';

type Step = 'welcome' | 'theme' | 'done';

interface Props {
  currentTheme: string;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onComplete: () => void;
}

const FEATURED_THEME_KEYS = [
  'termpod-dark',
  'termpod-light',
  'tokyo-night',
  'tokyo-night-light',
  'dracula',
  'catppuccin-mocha',
  'catppuccin-latte',
  'one-dark',
  'one-light',
  'github-dark',
  'github-light',
  'nord',
  'rose-pine',
  'rose-pine-dawn',
  'gruvbox-dark',
  'gruvbox-light',
  'solarized-dark',
  'solarized-light',
];

export function OnboardingScreen({ currentTheme, onUpdateSettings, onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [animating, setAnimating] = useState(false);

  const goTo = (next: Step) => {
    setAnimating(true);
    setTimeout(() => {
      setStep(next);
      setAnimating(false);
    }, 180);
  };

  const handleComplete = () => {
    onUpdateSettings({ onboardingComplete: true });
    onComplete();
  };

  return (
    <div
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to TermPod"
    >
      <div
        className={`onboarding-card${animating ? ' onboarding-fade-out' : ' onboarding-fade-in'}`}
      >
        {step === 'welcome' && <WelcomeStep onNext={() => goTo('theme')} />}
        {step === 'theme' && (
          <ThemeStep
            currentTheme={currentTheme}
            onSelectTheme={(key) => onUpdateSettings({ theme: key })}
            onNext={() => goTo('done')}
          />
        )}
        {step === 'done' && <DoneStep onComplete={handleComplete} />}
        <StepDots step={step} />
      </div>
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-logo" aria-hidden="true">
        <svg
          width="56"
          height="56"
          viewBox="0 0 56 56"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect width="56" height="56" rx="14" fill="var(--accent)" fillOpacity="0.15" />
          <rect x="10" y="22" width="36" height="3" rx="1.5" fill="var(--accent)" />
          <rect
            x="10"
            y="30"
            width="22"
            height="3"
            rx="1.5"
            fill="var(--accent)"
            fillOpacity="0.6"
          />
          <rect
            x="10"
            y="14"
            width="8"
            height="3"
            rx="1.5"
            fill="var(--text-muted)"
            fillOpacity="0.5"
          />
          <rect
            x="20"
            y="14"
            width="8"
            height="3"
            rx="1.5"
            fill="var(--text-muted)"
            fillOpacity="0.5"
          />
        </svg>
      </div>
      <h1 className="onboarding-title">Welcome to TermPod</h1>
      <p className="onboarding-tagline">Your terminal, everywhere.</p>
      <p className="onboarding-body">
        Start a terminal session on your Mac and access it from your iPhone in real time — over
        local Wi-Fi, WebRTC, or the cloud relay.
      </p>
      <button
        className="onboarding-btn-primary"
        onClick={onNext}
        type="button"
        aria-label="Get started — go to theme selection"
      >
        Get Started
      </button>
    </div>
  );
}

function ThemeStep({
  currentTheme,
  onSelectTheme,
  onNext,
}: {
  currentTheme: string;
  onSelectTheme: (key: string) => void;
  onNext: () => void;
}) {
  const darkThemes = FEATURED_THEME_KEYS.filter(
    (k) => THEMES[k] && !isLightColor(THEMES[k].background),
  );
  const lightThemes = FEATURED_THEME_KEYS.filter(
    (k) => THEMES[k] && isLightColor(THEMES[k].background),
  );

  return (
    <div className="onboarding-step onboarding-step-theme">
      <h2 className="onboarding-title">Pick a theme</h2>
      <p className="onboarding-body">Choose a color scheme for your terminal.</p>
      <div className="onboarding-theme-section">
        <div className="onboarding-theme-label">Dark</div>
        <div className="onboarding-theme-grid">
          {darkThemes.map((key) => (
            <ThemeSwatch
              key={key}
              themeKey={key}
              selected={currentTheme === key}
              onSelect={onSelectTheme}
            />
          ))}
        </div>
      </div>
      <div className="onboarding-theme-section">
        <div className="onboarding-theme-label">Light</div>
        <div className="onboarding-theme-grid">
          {lightThemes.map((key) => (
            <ThemeSwatch
              key={key}
              themeKey={key}
              selected={currentTheme === key}
              onSelect={onSelectTheme}
            />
          ))}
        </div>
      </div>
      <button
        className="onboarding-btn-primary"
        onClick={onNext}
        type="button"
        aria-label="Continue to final step"
      >
        Continue
      </button>
    </div>
  );
}

function ThemeSwatch({
  themeKey,
  selected,
  onSelect,
}: {
  themeKey: string;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const theme = THEMES[themeKey];
  if (!theme) return null;

  return (
    <button
      className={`onboarding-theme-swatch${selected ? ' onboarding-theme-swatch-selected' : ''}`}
      onClick={() => onSelect(themeKey)}
      type="button"
      title={theme.name}
      style={{ backgroundColor: theme.background }}
      aria-label={`${theme.name} theme${selected ? ' (selected)' : ''}`}
      aria-pressed={selected}
    >
      <div className="onboarding-swatch-lines">
        <div
          className="onboarding-swatch-line"
          style={{ backgroundColor: theme.foreground, width: '70%' }}
        />
        <div
          className="onboarding-swatch-line"
          style={{ backgroundColor: theme.foreground, width: '50%', opacity: 0.6 }}
        />
        <div
          className="onboarding-swatch-line"
          style={{ backgroundColor: theme.foreground, width: '60%', opacity: 0.4 }}
        />
      </div>
      <div className="onboarding-swatch-dots">
        <span className="onboarding-swatch-dot" style={{ backgroundColor: theme.red }} />
        <span className="onboarding-swatch-dot" style={{ backgroundColor: theme.green }} />
        <span className="onboarding-swatch-dot" style={{ backgroundColor: theme.blue }} />
      </div>
      <div
        className="onboarding-swatch-name"
        style={{ color: isLightColor(theme.background) ? '#333' : '#eee' }}
      >
        {theme.name}
      </div>
    </button>
  );
}

function DoneStep({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-done-icon" aria-hidden="true">
        <svg
          width="56"
          height="56"
          viewBox="0 0 56 56"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect width="56" height="56" rx="14" fill="var(--success)" fillOpacity="0.15" />
          <path
            d="M17 28L24 35L39 20"
            stroke="var(--success)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="onboarding-title">You're all set!</h2>
      <p className="onboarding-body">A few shortcuts to get you started:</p>
      <div className="onboarding-tips">
        <div className="onboarding-tip">
          <kbd className="onboarding-kbd">Cmd T</kbd>
          <span>New tab</span>
        </div>
        <div className="onboarding-tip">
          <kbd className="onboarding-kbd">Cmd W</kbd>
          <span>Close tab</span>
        </div>
        <div className="onboarding-tip">
          <kbd className="onboarding-kbd">Cmd ,</kbd>
          <span>Settings</span>
        </div>
        <div className="onboarding-tip">
          <kbd className="onboarding-kbd">Cmd Shift P</kbd>
          <span>Command palette</span>
        </div>
      </div>
      <button className="onboarding-btn-primary" onClick={onComplete} type="button">
        Start Using TermPod
      </button>
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const steps: Step[] = ['welcome', 'theme', 'done'];
  const currentIndex = steps.indexOf(step) + 1;
  return (
    <div
      className="onboarding-dots"
      role="progressbar"
      aria-valuenow={currentIndex}
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-label={`Step ${currentIndex} of ${steps.length}`}
    >
      {steps.map((s, i) => (
        <div
          key={s}
          className={`onboarding-dot${step === s ? ' onboarding-dot-active' : ''}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
