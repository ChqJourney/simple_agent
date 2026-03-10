import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WelcomePage, WorkspacePage, SettingsPage } from './pages';
import { WebSocketProvider } from './contexts/WebSocketContext';
import "./index.css";

function App() {
  return (
    <BrowserRouter>
      <WebSocketProvider>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </WebSocketProvider>
    </BrowserRouter>
  );
}

export default App;