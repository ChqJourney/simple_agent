import { useEffect, useState } from 'react';
import { useUIStore } from '../../stores';

const SHOW_DELAY_MS = 300;
const FADE_DURATION_MS = 200;

export const LoadingOverlay = () => {
  const isPageLoading = useUIStore((state) => state.isPageLoading);
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    if (isPageLoading) {
      showTimer = setTimeout(() => {
        setIsMounted(true);
        requestAnimationFrame(() => setIsVisible(true));
      }, SHOW_DELAY_MS);
    } else {
      setIsVisible(false);
      hideTimer = setTimeout(() => setIsMounted(false), FADE_DURATION_MS);
    }

    return () => {
      if (showTimer) {
        clearTimeout(showTimer);
      }
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
    };
  }, [isPageLoading]);

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-gray-600 dark:text-gray-300">Loading...</span>
      </div>
    </div>
  );
};
