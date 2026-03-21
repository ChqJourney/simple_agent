import React, { useState, useRef, useEffect } from 'react';
import { Attachment, ExecutionMode } from '../../types';
import { isImagePath } from '../../utils/fileTypes';
import { clearActiveDraggedFileDescriptors, getActiveDraggedFileDescriptors } from '../../utils/internalDragState';

const FILE_TREE_DRAG_MIME = 'application/x-tauri-agent-file';
const FILE_TREE_IMAGE_DRAG_MIME = 'application/x-tauri-agent-image';

interface DraggedFileDescriptor {
  path: string;
  name?: string;
  isDirectory?: boolean;
  isImage?: boolean;
}

interface MessageInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
  onInterrupt?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  executionMode?: ExecutionMode;
  supportsImageAttachments?: boolean;
}

function parseDraggedDescriptors(raw: string): DraggedFileDescriptor[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    return candidates.filter(
      (candidate): candidate is DraggedFileDescriptor =>
        Boolean(candidate)
        && typeof candidate === 'object'
        && typeof (candidate as { path?: unknown }).path === 'string'
    );
  } catch {
    return [];
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (!isImageFile(file)) {
    return null;
  }

  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);

  return {
    kind: 'image',
    path: file.name,
    name: file.name,
    mime_type: file.type || 'image/png',
    data_url: `data:${file.type || 'image/png'};base64,${base64}`,
  };
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || isImagePath(file.name);
}

function descriptorsToImageAttachments(descriptors: DraggedFileDescriptor[]): Attachment[] {
  return descriptors
    .filter((descriptor) => descriptor.isImage || isImagePath(descriptor.path))
    .map((descriptor) => ({
      kind: 'image' as const,
      path: descriptor.path,
      name: descriptor.name || descriptor.path.split(/[\\/]/).pop() || descriptor.path,
      mime_type: undefined,
    }));
}

function hasImagePayload(dataTransfer: DataTransfer): boolean {
  const activeDescriptors = getActiveDraggedFileDescriptors();
  if (activeDescriptors.some((descriptor) => descriptor.isImage || isImagePath(descriptor.path))) {
    return true;
  }

  const dragTypes = Array.from(dataTransfer.types || []);
  if (dragTypes.includes(FILE_TREE_IMAGE_DRAG_MIME)) {
    return true;
  }

  const descriptors = parseDraggedDescriptors(dataTransfer.getData(FILE_TREE_DRAG_MIME));
  if (descriptors.some((descriptor) => descriptor.isImage || isImagePath(descriptor.path))) {
    return true;
  }

  if (Array.from(dataTransfer.items || []).some((item) => {
    if (item.kind !== 'file') {
      return false;
    }
    if (item.type.startsWith('image/')) {
      return true;
    }
    const file = item.getAsFile?.();
    return Boolean(file && isImageFile(file));
  })) {
    return true;
  }

  return Array.from(dataTransfer.files || []).some((file) => isImageFile(file));
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  onExecutionModeChange,
  onInterrupt,
  isStreaming = false,
  disabled = false,
  placeholder = 'Type your message...',
  executionMode = 'regular',
  supportsImageAttachments = false,
}) => {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageDragDepthRef = useRef(0);
  const isInputDisabled = disabled || isStreaming;
  const canAttachImages = supportsImageAttachments && !isStreaming;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content]);

  const resetImageDragState = () => {
    imageDragDepthRef.current = 0;
    setIsImageDragActive(false);
  };

  useEffect(() => {
    if (!supportsImageAttachments && attachments.length > 0) {
      setAttachments([]);
    }
    if (!supportsImageAttachments) {
      resetImageDragState();
      clearActiveDraggedFileDescriptors();
    }
  }, [attachments.length, supportsImageAttachments]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((content.trim() || attachments.length > 0) && !isInputDisabled) {
      onSend(content.trim(), attachments);
      setContent('');
      setAttachments([]);
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

  const insertPathsIntoPrompt = (paths: string[]) => {
    const normalizedPaths = paths.filter(Boolean);
    if (normalizedPaths.length === 0) {
      return;
    }

    setContent((previous) => {
      const prefix = previous.trim() ? `${previous.trim()}\n` : '';
      return `${prefix}${normalizedPaths.join('\n')}`;
    });
  };

  const appendImageAttachments = (nextAttachments: Attachment[]) => {
    if (nextAttachments.length === 0) {
      return;
    }

    setAttachments((previous) => {
      const existingKeys = new Set(previous.map((attachment) => `${attachment.name}:${attachment.path}`));
      const deduped = nextAttachments.filter(
        (attachment) => !existingKeys.has(`${attachment.name}:${attachment.path}`)
      );
      return [...previous, ...deduped];
    });
  };

  const handlePromptDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    if (canAttachImages && hasImagePayload(e.dataTransfer)) {
      resetImageDragState();
      await appendDroppedImageAttachments(e.dataTransfer);
      clearActiveDraggedFileDescriptors();
      return;
    }

    const descriptors = parseDraggedDescriptors(e.dataTransfer.getData(FILE_TREE_DRAG_MIME));
    const effectiveDescriptors = descriptors.length > 0 ? descriptors : getActiveDraggedFileDescriptors();
    insertPathsIntoPrompt(effectiveDescriptors.map((descriptor) => descriptor.path));
    clearActiveDraggedFileDescriptors();
  };

  const appendDroppedImageAttachments = async (dataTransfer: DataTransfer) => {
    const descriptors = parseDraggedDescriptors(dataTransfer.getData(FILE_TREE_DRAG_MIME));
    const effectiveDescriptors = descriptors.length > 0 ? descriptors : getActiveDraggedFileDescriptors();
    const descriptorAttachments = descriptorsToImageAttachments(effectiveDescriptors);
    const fileAttachments = (await Promise.all(
      Array.from(dataTransfer.files || []).map((file) => fileToAttachment(file))
    ))
      .filter((attachment): attachment is Attachment => attachment !== null);

    appendImageAttachments([...descriptorAttachments, ...fileAttachments]);
  };

  const handleAttachmentDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resetImageDragState();
    await appendDroppedImageAttachments(e.dataTransfer);
    clearActiveDraggedFileDescriptors();
  };

  const handleComposerDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAttachImages || !hasImagePayload(e.dataTransfer)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    resetImageDragState();
    await appendDroppedImageAttachments(e.dataTransfer);
    clearActiveDraggedFileDescriptors();
  };

  const handleComposerDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAttachImages || !hasImagePayload(e.dataTransfer)) {
      return;
    }

    e.preventDefault();
    imageDragDepthRef.current += 1;
    setIsImageDragActive(true);
  };

  const handleComposerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAttachImages || !hasImagePayload(e.dataTransfer)) {
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsImageDragActive(true);
  };

  const handleComposerDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAttachImages || !hasImagePayload(e.dataTransfer)) {
      return;
    }

    e.preventDefault();
    imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1);
    if (imageDragDepthRef.current === 0) {
      setIsImageDragActive(false);
    }
  };

  const removeAttachment = (target: Attachment) => {
    setAttachments((previous) =>
      previous.filter((attachment) => `${attachment.name}:${attachment.path}` !== `${target.name}:${target.path}`)
    );
  };

  const handleExecutionModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value === 'free' ? 'free' : 'regular';
    onExecutionModeChange?.(value);
  };

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2 md:px-6 md:pb-6">
      <div
        data-testid="composer-shell"
        className="relative rounded-[1.75rem] bg-white/92 p-3 shadow-lg shadow-gray-200/60 backdrop-blur dark:bg-gray-900/90 dark:shadow-black/20"
        onDragEnter={handleComposerDragEnter}
        onDragOver={handleComposerDragOver}
        onDragLeave={handleComposerDragLeave}
        onDrop={(e) => void handleComposerDrop(e)}
      >
        {canAttachImages && isImageDragActive && (
          <div
            aria-label="Image attachment drop zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => void handleAttachmentDrop(e)}
            className="mb-3 rounded-[1.25rem] border border-dashed border-blue-300 bg-blue-50/90 px-4 py-4 text-sm text-blue-700 transition-colors dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-200"
          >
            <div className="font-medium">Drop images here</div>
            <div className="text-xs opacity-80">Images are attached to the next user message.</div>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <button
                key={`${attachment.name}:${attachment.path}`}
                type="button"
                onClick={() => removeAttachment(attachment)}
                className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-100 dark:hover:bg-blue-900"
              >
                {attachment.name}
              </button>
            ))}
          </div>
        )}

        <div className={`relative overflow-hidden rounded-[1.5rem] border border-gray-200 bg-gray-50/90 dark:border-gray-700 dark:bg-gray-800/85 ${attachments.length > 0 || (canAttachImages && isImageDragActive) ? '' : 'mt-0'}`}>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handlePromptDrop}
            placeholder={placeholder}
            disabled={isInputDisabled}
            rows={4}
            className="min-h-[6.5rem] max-h-60 w-full resize-none bg-transparent px-4 py-4 pb-16 pr-20 text-gray-900 outline-none transition-colors placeholder:text-gray-500 dark:text-gray-100 dark:placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-70"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onInterrupt}
              disabled={disabled}
              aria-label="Stop generating"
              title="Stop generating"
              className="absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500 text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="5" y="5" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || (!content.trim() && attachments.length === 0)}
              aria-label="Send message"
              title="Send message"
              className="absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M3 10.5L16.5 3.5L13.5 16.5L9.75 11.25L3 10.5Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <div className="flex items-center border-gray-200/80 px-4 py-3 dark:border-gray-700/80">
            <label htmlFor="execution-mode-select" className="text-xs font-semibold tracking-[0.12em] text-gray-600 dark:text-gray-300">
              Execution mode
            </label>
            <select
              id="execution-mode-select"
              aria-label="Execution mode"
              value={executionMode}
              onChange={handleExecutionModeChange}
              disabled={isInputDisabled}
              className="rounded-lg ml-2 border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <option value="regular">Regular</option>
              <option value="free">Free</option>
            </select>
          </div>
        </div>
      </div>
    </form>
  );
};
