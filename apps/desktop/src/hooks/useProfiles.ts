import { useCallback, useSyncExternalStore } from 'react';
import { ConfigStore } from '../lib/configStore';

export interface TerminalProfile {
  id: string;
  name: string;
  shell: string;
  cwd: string;
  env: Record<string, string>;
  theme?: string;
  fontSize?: number;
}

interface ProfilesConfig {
  profiles: TerminalProfile[];
  defaultProfileId: string | null;
}

const DEFAULTS: ProfilesConfig = {
  profiles: [],
  defaultProfileId: null,
};

const profilesStore = new ConfigStore<ProfilesConfig>(
  'profiles.json',
  DEFAULTS,
  'termpod-profiles',
);

export function useProfiles() {
  const config = useSyncExternalStore(profilesStore.subscribe, profilesStore.getSnapshot);

  const addProfile = useCallback((profile: Omit<TerminalProfile, 'id'>) => {
    const id = crypto.randomUUID();
    const newProfile: TerminalProfile = { id, ...profile };
    const current = profilesStore.getSnapshot();
    profilesStore.update({
      profiles: [...current.profiles, newProfile],
    });
    return id;
  }, []);

  const updateProfile = useCallback((id: string, patch: Partial<Omit<TerminalProfile, 'id'>>) => {
    const current = profilesStore.getSnapshot();
    profilesStore.update({
      profiles: current.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  }, []);

  const removeProfile = useCallback((id: string) => {
    const current = profilesStore.getSnapshot();
    const next = current.profiles.filter((p) => p.id !== id);
    const nextDefaultId =
      current.defaultProfileId === id ? (next[0]?.id ?? null) : current.defaultProfileId;
    profilesStore.replace({
      profiles: next,
      defaultProfileId: nextDefaultId,
    });
  }, []);

  const setDefault = useCallback((id: string | null) => {
    profilesStore.update({ defaultProfileId: id });
  }, []);

  return {
    profiles: config.profiles,
    defaultProfileId: config.defaultProfileId,
    addProfile,
    updateProfile,
    removeProfile,
    setDefault,
  };
}
