import { useCallback, useEffect, useRef, useState } from 'react';
import type { NewProjectResult } from '../../shared/types';
import { api, ApiError, MOCK, UNAUTHORIZED_EVENT } from './api';
import { bumpData, navigate, useNow, useResource, useRoute, type Screen } from './hooks';
import { Backdrop, BottomNav, Rail, TopBar } from './components/Shell';
import { Toasts, toast } from './components/Toasts';
import { NEW_PROJECT_EVENT, NewProjectSheet } from './components/NewProjectSheet';
import { OverviewScreen } from './screens/Overview';
import { ProjectsScreen } from './screens/Projects';
import { PullsScreen } from './screens/Pulls';
import { ClaudeScreen } from './screens/Claude';
import { SettingsScreen } from './screens/Settings';
import { UsageScreen } from './screens/Usage';

const TITLES: Record<Screen, string> = {
  overview: 'Overview',
  projects: 'Projects',
  pulls: 'Pull requests',
  claude: 'Claude',
  usage: 'Usage',
  settings: 'Settings',
};

export function App() {
  const route = useRoute();
  const health = useResource('health', api.health, 30_000);
  const settings = useResource('settings', api.settings);
  const now = useNow();
  const [condensed, setCondensed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const lastAuthToast = useRef(0);

  // Top bar condenses once the page title scrolls under it.
  useEffect(() => {
    const on = () => setCondensed(window.scrollY > 44);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.screen]);

  useEffect(() => { document.title = route.screen === 'overview' ? 'ClaudeHub' : `${TITLES[route.screen]} · ClaudeHub`; }, [route.screen]);

  // Any 401 sends the user to Settings to enter the token.
  useEffect(() => {
    const on = () => {
      if (Date.now() - lastAuthToast.current > 5000) {
        lastAuthToast.current = Date.now();
        toast('Enter the access token from the Mac');
      }
      if (location.hash.indexOf('#/settings') !== 0) navigate('settings', null, undefined, true);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on);
  }, []);

  useEffect(() => {
    const on = () => setNewOpen(true);
    window.addEventListener(NEW_PROJECT_EVENT, on);
    return () => window.removeEventListener(NEW_PROJECT_EVENT, on);
  }, []);

  const scanning = refreshing || !!health.data?.scanning;

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await api.refresh();
      // Poll until the rescan finishes, then refetch everything.
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 600 : 1500));
        const h = await api.health();
        health.setData(h);
        if (!h.scanning) break;
      }
      bumpData();
      toast('Up to date', { tone: 'good' });
    } catch (e) {
      toast(e instanceof ApiError && e.kind !== 'offline' ? e.message : 'Agent offline', { tone: 'bad' });
      bumpData();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, health]);

  const onCreated = (r: NewProjectResult) => {
    setNewOpen(false);
    toast(r.message, { tone: 'good' });
    bumpData();
    if (r.job) navigate('claude', r.job.id, { project: r.project?.id ?? r.job.projectId });
    else if (r.project) navigate('projects', r.project.id);
  };

  const offline = health.error?.kind === 'offline';
  const s = route.screen;

  return (
    <div className="shell">
      <Backdrop />
      <Rail screen={s} health={health.data} offline={offline} />
      <div className="main">
        <TopBar
          title={TITLES[s]}
          condensed={condensed}
          updatedAt={health.data?.lastScanAt ?? null}
          scanning={scanning}
          onRefresh={refresh}
          now={now}
        />
        <main className="page" id="main">
          {s === 'overview' && <OverviewScreen health={health.data} />}
          {s === 'projects' && <ProjectsScreen route={route} settings={settings.data} />}
          {s === 'pulls' && <PullsScreen route={route} />}
          {s === 'claude' && <ClaudeScreen route={route} settings={settings.data} />}
          {s === 'usage' && <UsageScreen />}
          {s === 'settings' && <SettingsScreen settings={settings} health={health} />}
          {MOCK && <p className="meta" style={{ textAlign: 'center', margin: '24px 0 0' }}>Sample data</p>}
        </main>
      </div>
      <BottomNav screen={s} />
      <NewProjectSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        defaultModel={settings.data?.defaultModel}
        githubReady={health.data?.checks.github.ok ?? true}
        onCreated={onCreated}
      />
      <Toasts />
    </div>
  );
}
