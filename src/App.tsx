import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WelcomePage, WorkspacePage, SettingsPage } from './pages';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { LoadingOverlay } from './components/common';
import { useUIStore } from './stores';
import { useEffect } from 'react';
import "./index.css";

function App() {
  const setPageLoading = useUIStore((state) => state.setPageLoading);

  useEffect(() => {
    setPageLoading(false);
  }, [setPageLoading]);

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