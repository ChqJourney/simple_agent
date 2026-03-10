import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WelcomePage, WorkspacePage, SettingsPage } from './pages';
import "./index.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;