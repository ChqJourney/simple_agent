import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WelcomePage, WorkspacePage, SettingsPage } from './pages';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { LoadingOverlay } from './components/common';
import { useUIStore } from './stores';
import './index.css';

function App() {
  const setPageLoading = useUIStore((state) => state.setPageLoading);
  const theme = useUIStore((state) => state.theme);

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

  return (
    <BrowserRouter>
      <WebSocketProvider>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        <LoadingOverlay />
      </WebSocketProvider>
    </BrowserRouter>
  );
}

export default App;
