import React, { useState, useRef, useEffect } from 'react';

interface MessageInputProps {
  onSend: (content: string) => void;
  onInterrupt?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  onInterrupt,
  isStreaming = false,
  disabled = false,
  placeholder = 'Type your message...',
}) => {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isInputDisabled = disabled || isStreaming;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim() && !isInputDisabled) {
      onSend(content.trim());
      setContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isStreaming) {
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2 md:px-6 md:pb-6">
      <div className="flex items-end gap-3 rounded-[1.75rem] bg-white/90 p-3 shadow-lg shadow-gray-200/60 backdrop-blur dark:bg-gray-900/90 dark:shadow-black/20">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isInputDisabled}
          rows={3}
          className="min-h-[5.25rem] max-h-52 flex-1 resize-none rounded-[1.35rem] bg-gray-100 px-4 py-3 text-gray-900 outline-none transition-colors placeholder:text-gray-500 focus:bg-gray-50 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400 dark:focus:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onInterrupt}
            disabled={disabled}
            aria-label="Stop generating"
            title="Stop generating"
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500 text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <rect x="5" y="5" width="10" height="10" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || !content.trim()}
            aria-label="Send message"
            title="Send message"
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M3 10.5L16.5 3.5L13.5 16.5L9.75 11.25L3 10.5Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
};
