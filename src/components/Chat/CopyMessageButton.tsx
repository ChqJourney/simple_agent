import { useEffect, useRef, useState } from 'react';

interface CopyMessageButtonProps {
  text: string;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export const CopyMessageButton = ({ text }: CopyMessageButtonProps) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);

  const handleCopy = async () => {
    try {
      await copyText(text);
      setStatus('copied');
    } catch (error) {
      console.error('Failed to copy message text:', error);
      setStatus('error');
    }

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      setStatus('idle');
    }, 1500);
  };

  const label = status === 'copied'
    ? 'Copied message'
    : status === 'error'
      ? 'Copy failed'
      : 'Copy message';

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={`rounded-lg p-1.5 transition-colors ${
        status === 'copied'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
          : status === 'error'
            ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300'
      }`}
      aria-label={label}
      title={label}
    >
      {status === 'copied' ? (
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5l3.25 3.25L15.5 6" />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <rect x="7" y="5" width="8" height="10" rx="1.75" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 11V6.75C5.5 5.78 6.28 5 7.25 5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.5h4" />
        </svg>
      )}
    </button>
  );
};
