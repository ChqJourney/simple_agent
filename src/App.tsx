import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatContainer } from './components/Chat';
import { SettingsModal } from './components/Settings';

const IS_DEV = import.meta.env.DEV;

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [backendReady, setBackendReady] = useState(false);

  useEffect(() => {
    if (IS_DEV) {
      const checkBackend = async () => {
        try {
          const response = await fetch('http://127.0.0.1:8765/health');
          if (response.ok) {
            setBackendReady(true);
          }
        } catch {
          console.log('Backend not ready, retrying...');
        }
      };
      
      checkBackend();
      const interval = setInterval(checkBackend, 2000);
      return () => clearInterval(interval);
    } else {
      setBackendReady(true);
    }
  }, []);

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900">
      <Sidebar onOpenSettings={() => setIsSettingsOpen(true)} />
      
      <main className="flex-1 flex flex-col">
        {IS_DEV && !backendReady && (
          <div className="p-4 bg-yellow-50 dark:bg-yellow-950 text-yellow-900 dark:text-yellow-200 text-center text-sm">
            Waiting for Python backend at http://127.0.0.1:8765...
            <br />
            <code className="text-xs bg-yellow-100 dark:bg-yellow-900 px-1.5 py-0.5 rounded">cd python_backend && python main.py</code>
          </div>
        )}
        <ChatContainer />
      </main>
      
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
    </div>
  );
}

export default App;