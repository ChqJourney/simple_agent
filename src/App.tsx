import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { WelcomePage, WorkspacePage, SettingsPage } from './pages';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { LoadingOverlay } from './components/common';
import { useUIStore } from './stores';
import './index.css';

function RoutedContent() {
  const location = useLocation();
  const needsRealtimeBackend =
    location.pathname === '/settings' || location.pathname.startsWith('/workspace/');

  const routes = (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );

  return (
    <>
      {needsRealtimeBackend ? <WebSocketProvider>{routes}</WebSocketProvider> : routes}
      <LoadingOverlay />
    </>
  );
}

function App() {
  const setPageLoading = useUIStore((state) => state.setPageLoading);
  const theme = useUIStore((state) => state.theme);
  const baseFontSize = useUIStore((state) => state.baseFontSize);

  useEffect(() => {
    setPageLoading(false);
  }, [setPageLoading]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const resolvedTheme = theme === 'system'
        ? (mediaQuery.matches ? 'dark' : 'light')
        : theme;

      document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
      document.documentElement.style.colorScheme = resolvedTheme;
      document.documentElement.dataset.theme = resolvedTheme;
    };

    applyTheme();

    if (theme !== 'system') {
      return undefined;
    }

    mediaQuery.addEventListener('change', applyTheme);
    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${baseFontSize}px`;
  }, [baseFontSize]);

  return (
    <BrowserRouter>
      <RoutedContent />
    </BrowserRouter>
  );
}

export default App;
