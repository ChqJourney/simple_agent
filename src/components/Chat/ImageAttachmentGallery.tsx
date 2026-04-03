import React, { memo, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import type { Attachment } from '../../types';
import { attachmentKey, resolveAttachmentPreviewSrc } from '../../utils/imageAttachments';

interface ImageAttachmentGalleryProps {
  attachments: Attachment[];
  align?: 'start' | 'end';
}

interface AttachmentThumbnailProps {
  attachment: Attachment;
  onOpenPreview: (attachment: Attachment) => void;
}

const previewCache = new Map<string, string | null>();

function useResolvedPreview(attachment: Attachment): string | null {
  const [previewSrc, setPreviewSrc] = useState<string | null>(attachment.data_url || null);

  useEffect(() => {
    let cancelled = false;

    if (attachment.data_url) {
      setPreviewSrc(attachment.data_url);
      return undefined;
    }

    const cacheKey = attachment.path;
    if (previewCache.has(cacheKey)) {
      setPreviewSrc(previewCache.get(cacheKey) ?? null);
      return undefined;
    }

    setPreviewSrc(null);

    void resolveAttachmentPreviewSrc(attachment).then((resolvedPreviewSrc) => {
      previewCache.set(cacheKey, resolvedPreviewSrc);
      if (!cancelled) {
        setPreviewSrc(resolvedPreviewSrc);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attachment]);

  return previewSrc;
}

const AttachmentThumbnail = memo<AttachmentThumbnailProps>(({ attachment, onOpenPreview }) => {
  const { t } = useI18n();
  const previewSrc = useResolvedPreview(attachment);

  return (
    <div className="w-[7.5rem]">
      <div
        role="button"
        tabIndex={0}
        aria-label={t('chat.image.openPreview', { name: attachment.name })}
        title={t('chat.image.doubleClickPreview', { name: attachment.name })}
        onDoubleClick={() => onOpenPreview(attachment)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenPreview(attachment);
          }
        }}
        className="group flex cursor-zoom-in flex-col gap-2 rounded-2xl border border-blue-200 bg-blue-50/90 p-2 text-left text-xs font-medium text-blue-700 shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-400 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-100"
      >
        {previewSrc ? (
          <img
            src={previewSrc}
            alt={t('chat.input.attachmentPreview', { name: attachment.name })}
            className="h-20 w-full rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-20 w-full items-center justify-center rounded-xl border border-dashed border-blue-300/80 bg-white/70 px-2 text-center text-[11px] text-blue-600 dark:border-blue-700 dark:bg-gray-900/40 dark:text-blue-200">
            {t('chat.image.previewUnavailable')}
          </div>
        )}
        <span className="block truncate text-[11px] opacity-80">{t('chat.image.doubleClickHint')}</span>
      </div>
      <span className="mt-1 block truncate px-1 text-xs font-medium text-blue-700 dark:text-blue-100">
        {attachment.name}
      </span>
    </div>
  );
});

AttachmentThumbnail.displayName = 'AttachmentThumbnail';

interface AttachmentPreviewModalProps {
  attachment: Attachment;
  onClose: () => void;
}

const AttachmentPreviewModal: React.FC<AttachmentPreviewModalProps> = ({ attachment, onClose }) => {
  const { t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewSrc = useResolvedPreview(attachment);

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.image.modalLabel', { name: attachment.name })}
        className="w-full max-w-5xl rounded-[1.75rem] border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
              {attachment.name}
            </h3>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {attachment.path}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('chat.image.closePreview')}
            title={t('chat.image.closePreview')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-[18rem] items-center justify-center rounded-[1.5rem] bg-gray-100/90 p-4 dark:bg-gray-950/80">
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={t('chat.image.expandedPreview', { name: attachment.name })}
              className="max-h-[78vh] max-w-full rounded-xl object-contain"
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white/80 px-6 py-10 text-center text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/70 dark:text-gray-300">
              {t('chat.image.unableToLoadPreview')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ImageAttachmentGallery: React.FC<ImageAttachmentGalleryProps> = ({
  attachments,
  align = 'end',
}) => {
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  const justifyClass = align === 'end' ? 'justify-end' : 'justify-start';

  return (
    <>
      <div className={`mt-3 flex flex-wrap gap-3 ${justifyClass}`}>
        {attachments.map((attachment) => (
          <AttachmentThumbnail
            key={attachmentKey(attachment)}
            attachment={attachment}
            onOpenPreview={(nextAttachment) => {
              setSelectedAttachment(nextAttachment);
            }}
          />
        ))}
      </div>

      {selectedAttachment && (
        <AttachmentPreviewModal
          attachment={selectedAttachment}
          onClose={() => {
            setSelectedAttachment(null);
          }}
        />
      )}
    </>
  );
};
