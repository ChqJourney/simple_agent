import { useUIStore } from '../../stores';

export const LoadingOverlay = () => {
  const isPageLoading = useUIStore((state) => state.isPageLoading);

  if (!isPageLoading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 animate-fade-in">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-gray-600 dark:text-gray-300">Loading...</span>
      </div>
    </div>
  );
};