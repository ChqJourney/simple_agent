import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { Attachment, ExecutionMode } from '../../types';
import { isImagePath } from '../../utils/fileTypes';
import { clearActiveDraggedFileDescriptors, getActiveDraggedFileDescriptors } from '../../utils/internalDragState';
import {
  arrayBufferToBase64,
  getAttachmentPreviewSrc as getInlineAttachmentPreviewSrc,
  guessImageMimeType,
} from '../../utils/imageAttachments';
import { CustomSelect } from '../common';

const FILE_TREE_DRAG_MIME = 'application/x-tauri-agent-file';
const FILE_TREE_IMAGE_DRAG_MIME = 'application/x-tauri-agent-image';
const COMPOSER_TEXT_METRICS_CLASS = 'text-[0.95rem] leading-6 tracking-normal font-normal';

interface DraggedFileDescriptor {
  path: string;
  name?: string;
  isDirectory?: boolean;
  isImage?: boolean;
}

interface PromptPathReference {
  id: string;
  absolutePath: string;
  displayName: string;
  start: number;
  end: number;
}

interface MessageInputProps {
  onSend: (content: string, attachments?: Attachment[], displayContent?: string) => void;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
  onInterrupt?: () => void;
  isStreaming?: boolean;
  canInterrupt?: boolean;
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

async function descriptorToImageAttachment(descriptor: DraggedFileDescriptor): Promise<Attachment> {
  const name = descriptor.name || descriptor.path.split(/[\\/]/).filter(Boolean).pop() || descriptor.path;
  const mimeType = guessImageMimeType(descriptor.path);

  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(descriptor.path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const base64 = arrayBufferToBase64(buffer);
    return {
      kind: 'image',
      path: descriptor.path,
      name,
      mime_type: mimeType,
      data_url: `data:${mimeType};base64,${base64}`,
    };
  } catch {
    return {
      kind: 'image',
      path: descriptor.path,
      name,
      mime_type: mimeType,
    };
  }
}

async function descriptorsToImageAttachments(descriptors: DraggedFileDescriptor[]): Promise<Attachment[]> {
  const imageDescriptors = descriptors.filter((descriptor) => descriptor.isImage || isImagePath(descriptor.path));
  return Promise.all(imageDescriptors.map((descriptor) => descriptorToImageAttachment(descriptor)));
}

function getAttachmentPreviewSrc(attachment: Attachment): string | null {
  return getInlineAttachmentPreviewSrc(attachment);
}

function getInternalDraggedDescriptors(dataTransfer: DataTransfer): DraggedFileDescriptor[] {
  const descriptors = parseDraggedDescriptors(dataTransfer.getData(FILE_TREE_DRAG_MIME));
  if (descriptors.length > 0) {
    return descriptors;
  }

  return getActiveDraggedFileDescriptors();
}

function hasInternalFileTreePayload(dataTransfer: DataTransfer): boolean {
  const descriptors = getInternalDraggedDescriptors(dataTransfer);
  if (descriptors.length > 0) {
    return true;
  }

  const dragTypes = Array.from(dataTransfer.types || []);
  return dragTypes.includes(FILE_TREE_DRAG_MIME);
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

function hasExternalImagePayload(dataTransfer: DataTransfer): boolean {
  if (hasInternalFileTreePayload(dataTransfer)) {
    return false;
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

function hasPromptPathPayload(dataTransfer: DataTransfer): boolean {
  const activeDescriptors = getActiveDraggedFileDescriptors();
  if (activeDescriptors.some((descriptor) => !descriptor.isImage && !isImagePath(descriptor.path))) {
    return true;
  }

  const descriptors = parseDraggedDescriptors(dataTransfer.getData(FILE_TREE_DRAG_MIME));
  if (descriptors.some((descriptor) => !descriptor.isImage && !isImagePath(descriptor.path))) {
    return true;
  }

  return false;
}

function sortPromptPathReferences(references: PromptPathReference[]) {
  return [...references].sort((left, right) => left.start - right.start || left.end - right.end);
}

function serializePromptContent(
  text: string,
  references: PromptPathReference[],
  field: 'absolutePath' | 'displayName',
): string {
  if (references.length === 0) {
    return text.trim();
  }

  let cursor = 0;
  let output = '';

  for (const reference of sortPromptPathReferences(references)) {
    output += text.slice(cursor, reference.start);
    output += reference[field];
    cursor = reference.end;
  }

  output += text.slice(cursor);
  return output.trim();
}

function syncPromptPathReferences(
  previousText: string,
  nextText: string,
  previousReferences: PromptPathReference[],
): PromptPathReference[] {
  if (previousReferences.length === 0 || previousText === nextText) {
    return previousReferences;
  }

  let prefixLength = 0;
  while (
    prefixLength < previousText.length
    && prefixLength < nextText.length
    && previousText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousText.length - prefixLength
    && suffixLength < nextText.length - prefixLength
    && previousText[previousText.length - 1 - suffixLength] === nextText[nextText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const previousEditEnd = previousText.length - suffixLength;
  const delta = nextText.length - previousText.length;

  return sortPromptPathReferences(
    previousReferences.flatMap((reference) => {
      if (reference.end <= prefixLength) {
        return [reference];
      }

      if (reference.start >= previousEditEnd) {
        return [{
          ...reference,
          start: reference.start + delta,
          end: reference.end + delta,
        }];
      }

      return [];
    })
  );
}

function renderHighlightedContent(text: string, references: PromptPathReference[]) {
  if (!text) {
    return null;
  }

  const orderedReferences = sortPromptPathReferences(references);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  orderedReferences.forEach((reference) => {
    if (reference.start > cursor) {
      nodes.push(
        <span key={`text-${cursor}-${reference.start}`}>
          {text.slice(cursor, reference.start)}
        </span>
      );
    }

    nodes.push(
      <span
        key={reference.id}
        className="rounded-md bg-cyan-100/95 text-inherit ring-1 ring-cyan-200/90 dark:bg-cyan-900/35 dark:ring-cyan-700/70"
      >
        {reference.displayName}
      </span>
    );

    cursor = reference.end;
  });

  if (cursor < text.length) {
    nodes.push(
      <span key={`text-${cursor}-${text.length}`}>
        {text.slice(cursor)}
      </span>
    );
  }

  return nodes;
}

function findPromptPathForCaret(
  references: PromptPathReference[],
  caret: number,
  direction: 'backward' | 'forward',
) {
  const orderedReferences = sortPromptPathReferences(references);

  if (direction === 'backward') {
    return orderedReferences.find((reference) => caret > reference.start && caret <= reference.end);
  }

  return orderedReferences.find((reference) => caret >= reference.start && caret < reference.end);
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSend,
  onExecutionModeChange,
  onInterrupt,
  isStreaming = false,
  canInterrupt = true,
  disabled = false,
  placeholder,
  executionMode = 'regular',
  supportsImageAttachments = false,
}) => {
  const { t } = useI18n();
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [promptPaths, setPromptPaths] = useState<PromptPathReference[]>([]);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const imageDragDepthRef = useRef(0);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const isInputDisabled = disabled;
  const canSubmitMessage = !disabled && !isStreaming;
  const canAttachImages = supportsImageAttachments && !isStreaming;
  const resolvedPlaceholder = placeholder ?? t('chat.input.placeholder');

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

  const syncSelectionRef = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    selectionRef.current = {
      start: textarea.selectionStart ?? 0,
      end: textarea.selectionEnd ?? 0,
    };
  };

  const restoreSelection = (start: number, end: number = start) => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(start, end);
      selectionRef.current = { start, end };
    });
  };

  const updateContent = (nextContent: string) => {
    setPromptPaths((previous) => syncPromptPathReferences(content, nextContent, previous));
    setContent(nextContent);
  };

  const removePromptPathReference = (target: PromptPathReference) => {
    const previousCharacter = target.start > 0 ? content[target.start - 1] : '';
    const nextCharacter = target.end < content.length ? content[target.end] : '';
    let deleteStart = target.start;
    let deleteEnd = target.end;

    if (previousCharacter === ' ' && (!nextCharacter || /\s/.test(nextCharacter))) {
      deleteStart -= 1;
    } else if (nextCharacter === ' ') {
      deleteEnd += 1;
    }

    const nextContent = `${content.slice(0, deleteStart)}${content.slice(deleteEnd)}`;
    const removedLength = deleteEnd - deleteStart;

    setPromptPaths((previous) => sortPromptPathReferences(
      previous.flatMap((reference) => {
        if (reference.id === target.id) {
          return [];
        }

        if (reference.start >= deleteEnd) {
          return [{
            ...reference,
            start: reference.start - removedLength,
            end: reference.end - removedLength,
          }];
        }

        return [reference];
      })
    ));
    setContent(nextContent);
    restoreSelection(deleteStart);
  };

  const buildPromptContent = (field: 'absolutePath' | 'displayName') => {
    return serializePromptContent(content, promptPaths, field);
  };

  const insertPromptPathsAtSelection = (descriptors: DraggedFileDescriptor[]) => {
    const normalizedDescriptors = descriptors
      .filter((descriptor) => Boolean(descriptor.path))
      .map((descriptor) => ({
        absolutePath: descriptor.path,
        displayName: descriptor.name || descriptor.path.split(/[\\/]/).filter(Boolean).pop() || descriptor.path,
      }));

    if (normalizedDescriptors.length === 0) {
      return;
    }

    const { start, end } = selectionRef.current;
    const baseInsertionText = normalizedDescriptors.map((descriptor) => descriptor.displayName).join(' ');
    const beforeChar = start > 0 ? content[start - 1] : '';
    const afterChar = end < content.length ? content[end] : '';
    const prefixSpacer = beforeChar && !/\s/.test(beforeChar) ? ' ' : '';
    const suffixSpacer = afterChar && !/\s/.test(afterChar) ? ' ' : '';
    const insertionText = `${prefixSpacer}${baseInsertionText}${suffixSpacer}`;
    const nextContent = `${content.slice(0, start)}${insertionText}${content.slice(end)}`;
    const replacedLength = end - start;
    const delta = insertionText.length - replacedLength;
    let offset = 0;
    const insertedReferences: PromptPathReference[] = normalizedDescriptors.map((descriptor) => {
      const tokenStart = start + prefixSpacer.length + offset;
      const tokenEnd = tokenStart + descriptor.displayName.length;
      offset += descriptor.displayName.length + 1;

      return {
        id: `${descriptor.absolutePath}:${tokenStart}:${tokenEnd}:${Math.random().toString(36).slice(2, 8)}`,
        absolutePath: descriptor.absolutePath,
        displayName: descriptor.displayName,
        start: tokenStart,
        end: tokenEnd,
      };
    });

    setPromptPaths((previous) => {
      const preserved = previous.flatMap((reference) => {
        if (reference.end <= start) {
          return [reference];
        }

        if (reference.start >= end) {
          return [{
            ...reference,
            start: reference.start + delta,
            end: reference.end + delta,
          }];
        }

        return [];
      });

      return sortPromptPathReferences([...preserved, ...insertedReferences]);
    });
    setContent(nextContent);
    restoreSelection(start + insertionText.length);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const actualContent = buildPromptContent('absolutePath');
    const displayContent = buildPromptContent('displayName');

    if ((actualContent || attachments.length > 0) && canSubmitMessage) {
      onSend(actualContent, attachments, displayContent);
      setContent('');
      setAttachments([]);
      setPromptPaths([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isStreaming) {
      return;
    }

    syncSelectionRef();

    if (e.key === 'Backspace' || e.key === 'Delete') {
      const { start, end } = selectionRef.current;
      if (start === end) {
        const target = findPromptPathForCaret(
          promptPaths,
          start,
          e.key === 'Backspace' ? 'backward' : 'forward',
        );

        if (target) {
          e.preventDefault();
          removePromptPathReference(target);
          return;
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
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

  const appendDroppedImageAttachments = async (dataTransfer: DataTransfer) => {
    const effectiveDescriptors = getInternalDraggedDescriptors(dataTransfer);
    const descriptorAttachments = await descriptorsToImageAttachments(effectiveDescriptors);
    const fileAttachments = (await Promise.all(
      Array.from(dataTransfer.files || []).map((file) => fileToAttachment(file))
    ))
      .filter((attachment): attachment is Attachment => attachment !== null);

    appendImageAttachments([...descriptorAttachments, ...fileAttachments]);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canAttachImages) {
      return;
    }

    const clipboardData = e.clipboardData;
    const imageFiles = Array.from(clipboardData.files || []).filter((file) => isImageFile(file));
    if (imageFiles.length === 0) {
      return;
    }

    e.preventDefault();
    const pastedAttachments = (await Promise.all(imageFiles.map((file) => fileToAttachment(file))))
      .filter((attachment): attachment is Attachment => attachment !== null);
    appendImageAttachments(pastedAttachments);
  };

  const handlePromptDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    syncSelectionRef();

    const internalDescriptors = getInternalDraggedDescriptors(e.dataTransfer);
    if (internalDescriptors.length > 0) {
      resetImageDragState();
      insertPromptPathsAtSelection(internalDescriptors);
      clearActiveDraggedFileDescriptors();
      return;
    }

    if (canAttachImages && hasExternalImagePayload(e.dataTransfer)) {
      resetImageDragState();
      await appendDroppedImageAttachments(e.dataTransfer);
      clearActiveDraggedFileDescriptors();
      return;
    }

    const descriptors = parseDraggedDescriptors(e.dataTransfer.getData(FILE_TREE_DRAG_MIME));
    const effectiveDescriptors = descriptors.length > 0 ? descriptors : getActiveDraggedFileDescriptors();
    insertPromptPathsAtSelection(effectiveDescriptors);
    clearActiveDraggedFileDescriptors();
  };

  const handleAttachmentDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resetImageDragState();
    await appendDroppedImageAttachments(e.dataTransfer);
    clearActiveDraggedFileDescriptors();
  };

  const handleComposerDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    const containsImagePayload = canAttachImages && hasImagePayload(e.dataTransfer);
    const containsPromptPathPayload = hasPromptPathPayload(e.dataTransfer);

    if (!containsImagePayload && !containsPromptPathPayload) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (containsImagePayload) {
      resetImageDragState();
      await appendDroppedImageAttachments(e.dataTransfer);
      clearActiveDraggedFileDescriptors();
      return;
    }

    const effectiveDescriptors = getInternalDraggedDescriptors(e.dataTransfer);
    insertPromptPathsAtSelection(effectiveDescriptors);
    clearActiveDraggedFileDescriptors();
  };

  const handleComposerDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (hasPromptPathPayload(e.dataTransfer)) {
      e.preventDefault();
      return;
    }

    if (!canAttachImages || !hasImagePayload(e.dataTransfer)) {
      return;
    }

    e.preventDefault();
    imageDragDepthRef.current += 1;
    setIsImageDragActive(true);
  };

  const handleComposerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (hasPromptPathPayload(e.dataTransfer)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      return;
    }

    if (!canAttachImages || !hasImagePayload(e.dataTransfer)) {
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsImageDragActive(true);
  };

  const handleComposerDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (hasPromptPathPayload(e.dataTransfer)) {
      e.preventDefault();
      return;
    }

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

  const handleTextareaScroll = () => {
    if (!textareaRef.current || !highlightRef.current) {
      return;
    }

    highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
  };

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2 md:px-8 md:pb-6">
      <div
        data-testid="composer-shell"
        className="relative rounded-2xl bg-white/92 p-3 shadow-lg shadow-gray-200/60 backdrop-blur dark:bg-gray-900/90 dark:shadow-black/20"
        onDragEnter={handleComposerDragEnter}
        onDragOver={handleComposerDragOver}
        onDragLeave={handleComposerDragLeave}
        onDrop={(e) => void handleComposerDrop(e)}
      >
        {canAttachImages && isImageDragActive && (
          <div
            aria-label={t('chat.input.imageDropZone')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => void handleAttachmentDrop(e)}
            className="mb-3 rounded-[1.25rem] border border-dashed border-blue-300 bg-blue-50/90 px-4 py-4 text-sm text-blue-700 transition-colors dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-200"
          >
            <div className="font-medium">{t('chat.input.dropImagesHere')}</div>
            <div className="text-xs opacity-80">{t('chat.input.imagesAttachedHint')}</div>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={`${attachment.name}:${attachment.path}`}
                className="relative flex w-[7.5rem] flex-col items-start gap-2 rounded-2xl border border-blue-200 bg-blue-50/90 p-2 text-left text-xs font-medium text-blue-700 shadow-sm dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-100"
              >
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment)}
                  aria-label={t('chat.input.removeAttachment', { name: attachment.name })}
                  title={t('chat.input.removeAttachment', { name: attachment.name })}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-blue-700 shadow-sm transition-colors hover:bg-white dark:bg-gray-900/90 dark:text-blue-100"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </button>
                {getAttachmentPreviewSrc(attachment) && (
                  <img
                    src={getAttachmentPreviewSrc(attachment) || undefined}
                    alt={t('chat.input.attachmentPreview', { name: attachment.name })}
                    className="h-20 w-full rounded-xl object-cover"
                  />
                )}
                <span className="block w-full truncate pr-6">{attachment.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className={`relative overflow-visible rounded-xl border border-gray-200 bg-gray-50/90 dark:border-gray-700 dark:bg-gray-800/85 ${attachments.length > 0 || (canAttachImages && isImageDragActive) ? '' : 'mt-0'}`}>
          <div
            ref={highlightRef}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 overflow-hidden px-4 py-4 pb-16 pr-20 text-gray-900 dark:text-gray-100 ${COMPOSER_TEXT_METRICS_CLASS}`}
            style={{
              fontFamily: 'inherit',
              fontKerning: 'normal',
              textRendering: 'auto',
            }}
          >
            <div className="min-h-[8.25rem] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {content
                ? renderHighlightedContent(content, promptPaths)
                : <span className="text-gray-500 dark:text-gray-400">{resolvedPlaceholder}</span>}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            aria-label={t('chat.input.messageInput')}
            value={content}
            onChange={(e) => {
              selectionRef.current = {
                start: e.target.selectionStart ?? 0,
                end: e.target.selectionEnd ?? 0,
              };
              updateContent(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onClick={syncSelectionRef}
            onKeyUp={syncSelectionRef}
            onSelect={syncSelectionRef}
            onScroll={handleTextareaScroll}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handlePromptDrop}
            onPaste={(e) => void handlePaste(e)}
            placeholder={resolvedPlaceholder}
            disabled={isInputDisabled}
            rows={5}
            className={`relative z-10 h-[8.25rem] w-full resize-none overflow-y-auto bg-transparent px-4 py-4 pb-16 pr-20 text-transparent caret-gray-900 outline-none transition-colors selection:bg-blue-200/80 dark:caret-gray-100 dark:selection:bg-blue-700/40 disabled:cursor-not-allowed disabled:opacity-70 ${COMPOSER_TEXT_METRICS_CLASS}`}
            style={{
              fontFamily: 'inherit',
              fontKerning: 'normal',
              textRendering: 'auto',
            }}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onInterrupt}
              disabled={!canInterrupt}
              aria-label={t('chat.input.stopGenerating')}
              title={t('chat.input.stopGenerating')}
              className="absolute bottom-3 right-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500 text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <rect x="5" y="5" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSubmitMessage || (!content.trim() && attachments.length === 0)}
              aria-label={t('chat.input.sendMessage')}
              title={t('chat.input.sendMessage')}
              className="absolute bottom-3 right-3 flex h-8 w-20 items-center justify-center rounded-lg bg-slate-600 text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M3 10.5L16.5 3.5L13.5 16.5L9.75 11.25L3 10.5Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <div className="flex items-center border-gray-200/80 px-4 py-3 dark:border-gray-700/80">
            <label id="execution-mode-label" className="text-xs font-semibold tracking-[0.12em] text-gray-600 dark:text-gray-300">
              {t('chat.input.approval')}
            </label>
            <div className="ml-2 w-[148px] shrink-0">
              <CustomSelect
                id="execution-mode-select"
                ariaLabel={t('chat.input.executionMode')}
                ariaLabelledBy="execution-mode-label"
                value={executionMode}
                onChange={(nextValue) => onExecutionModeChange?.(nextValue === 'free' ? 'free' : 'regular')}
                disabled={disabled || isStreaming}
                options={[
                  { value: 'regular', label: t('chat.input.mode.regular'), hint: t('chat.input.mode.regularHint') },
                  { value: 'free', label: t('chat.input.mode.free'), hint: t('chat.input.mode.freeHint') },
                ]}
                showSelectedHint={false}
                menuPlacement="top"
                buttonClassName="min-h-0 rounded-lg px-2.5 py-1 text-xs"
                menuClassName="min-w-[220px]"
              />
            </div>
          </div>
        </div>
      </div>
    </form>
  );
};
