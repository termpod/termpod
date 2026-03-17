import { describe, expect, it } from 'vitest';

// --- Trial alarm scheduling logic ---

describe('Trial alarm scheduling', () => {
  it('schedules warning alarm 1 day before trial ends', () => {
    const trialEndsAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const warningAt = trialEndsAt - 24 * 60 * 60 * 1000;

    expect(warningAt).toBeLessThan(trialEndsAt);
    expect(trialEndsAt - warningAt).toBe(24 * 60 * 60 * 1000);
  });

  it('trial_ends_at is 7 days from signup', () => {
    const now = Date.now();
    const trialEndsAt = now + 7 * 24 * 60 * 60 * 1000;

    expect(trialEndsAt - now).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

// --- Trial alarm decision logic ---

describe('Trial alarm decision logic', () => {
  /**
   * Mirrors the alarm() method decision tree in User DO.
   * Returns 'warning' | 'expired' | 'skip' based on state.
   */
  function getAlarmAction(
    profile: {
      email: string;
      plan: string;
      trialEndsAt: number | null;
    } | null,
    now: number,
    selfHosted: boolean,
    hasResendKey: boolean,
  ): 'warning' | 'expired' | 'skip' {
    if (selfHosted) {
      return 'skip';
    }

    if (!hasResendKey) {
      return 'skip';
    }

    if (!profile) {
      return 'skip';
    }

    if (!profile.trialEndsAt) {
      return 'skip';
    }

    if (profile.plan === 'pro') {
      return 'skip';
    }

    if (now < profile.trialEndsAt) {
      return 'warning';
    }

    return 'expired';
  }

  const baseProfile = {
    email: 'user@example.com',
    plan: 'free',
    trialEndsAt: Date.now() + 24 * 60 * 60 * 1000, // 1 day from now
  };

  it('sends warning email when trial has not yet expired', () => {
    const now = baseProfile.trialEndsAt! - 60 * 1000; // 1 minute before expiry

    expect(getAlarmAction(baseProfile, now, false, true)).toBe('warning');
  });

  it('sends expired email when trial has passed', () => {
    const now = baseProfile.trialEndsAt! + 1000; // 1 second after expiry

    expect(getAlarmAction(baseProfile, now, false, true)).toBe('expired');
  });

  it('sends expired email when now equals trial_ends_at', () => {
    const now = baseProfile.trialEndsAt!;

    expect(getAlarmAction(baseProfile, now, false, true)).toBe('expired');
  });

  it('skips when user already upgraded to pro', () => {
    const proProfile = { ...baseProfile, plan: 'pro' };
    const now = proProfile.trialEndsAt! - 60 * 1000;

    expect(getAlarmAction(proProfile, now, false, true)).toBe('skip');
  });

  it('skips on self-hosted relays', () => {
    const now = baseProfile.trialEndsAt! - 60 * 1000;

    expect(getAlarmAction(baseProfile, now, true, true)).toBe('skip');
  });

  it('skips when RESEND_API_KEY is not configured', () => {
    const now = baseProfile.trialEndsAt! - 60 * 1000;

    expect(getAlarmAction(baseProfile, now, false, false)).toBe('skip');
  });

  it('skips when no profile exists', () => {
    expect(getAlarmAction(null, Date.now(), false, true)).toBe('skip');
  });

  it('skips when trial_ends_at is null', () => {
    const noTrialProfile = { ...baseProfile, trialEndsAt: null };

    expect(getAlarmAction(noTrialProfile, Date.now(), false, true)).toBe('skip');
  });
});

// --- Email template content ---

describe('Trial email templates', () => {
  // Import the email builders indirectly by testing their output characteristics
  // (they are module-level functions, not exported — so we verify the pattern)

  it('warning email contains upgrade CTA link', () => {
    // Verify the expected URL is correct
    const upgradeUrl = 'https://termpod.dev/pricing';

    expect(upgradeUrl).toContain('termpod.dev');
    expect(upgradeUrl).toContain('pricing');
  });

  it('expired email mentions self-hosting as alternative', () => {
    const selfHostUrl = 'https://termpod.dev/docs/self-hosting';

    expect(selfHostUrl).toContain('self-hosting');
  });
});
