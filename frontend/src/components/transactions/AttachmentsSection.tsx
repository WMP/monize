'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Select } from '@/components/ui/Select';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { getErrorMessage } from '@/lib/errors';
import { attachmentsApi, attachmentDownloadUrl } from '@/lib/attachments';
import { AttachmentPreviewDialog, type PreviewTarget } from './AttachmentPreviewDialog';
import { DocumentScanDialog, type ScanOutcome } from './DocumentScanDialog';
import { ScanDocumentControl } from './ScanDocumentControl';
import {
  StagedAttachment,
  Attachment,
  AttachmentParent,
  ACCEPTED_ATTACHMENT_TYPES,
  DEFAULT_DOCUMENT_KIND,
  DOCUMENT_KINDS,
  DocumentKind,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
} from '@/types/attachment';

/**
 * Saved mode: manages the attachments of an existing transaction directly
 * against the server. Warranty mode: the same saved list for a warranty's
 * documents, with a document kind chosen on upload and shown on each row
 * (`documentKind` is the kind the picker starts on). Staged mode: holds files
 * client-side for a transaction that does not exist yet (the New Transaction
 * window); the parent form uploads them once the transaction has been created.
 */
type AttachmentsSectionProps =
  | { transactionId: string }
  | { warrantyId: string; documentKind?: DocumentKind }
  | {
      stagedFiles: StagedAttachment[];
      onStagedFilesChange: (files: StagedAttachment[]) => void;
    };

type SavedParentKind = 'transaction' | 'warranty';


/**
 * Validate a freshly selected file against the shared limits. Returns a
 * translated error message when the file is rejected, or null when it is
 * acceptable. `currentCount` is the number of attachments already present
 * (existing + pending) so the per-transaction cap is enforced consistently in
 * both modes.
 */
function validateSelection(
  file: File,
  currentCount: number,
  t: (key: string, values?: Record<string, string | number>) => string,
  // A pure function cannot call the hook, so the component hands its formatter
  // down -- the `NumberFormatters` pattern, for one formatter.
  formatBytes: (bytes: number) => string,
): string | null {
  if (currentCount >= MAX_ATTACHMENTS_PER_TRANSACTION) {
    return t('tooMany', { max: MAX_ATTACHMENTS_PER_TRANSACTION });
  }
  if (!ACCEPTED_ATTACHMENT_TYPES.includes(file.type)) {
    return t('unsupported');
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return t('tooLarge', { max: formatBytes(MAX_ATTACHMENT_BYTES) });
  }
  return null;
}

/**
 * The section title with the Scan and Add controls, shared by both modes.
 *
 * On a phone the title takes a line of its own and the two buttons share the
 * next one edge to edge: beside the title, two labelled buttons overran the
 * dialog's width. The buttons are grid items there, so they stretch to their
 * half without knowing about the layout -- each control's hidden file input
 * is `display: none` and takes no cell. From `sm` up the title and the
 * buttons sit on one line as before.
 */
function AttachmentsHeader({
  children,
  heading,
}: {
  children: React.ReactNode;
  /**
   * A section heading in place of the "Attachments" label, for a page where
   * the list is a section of its own (a warranty's Documents) rather than a
   * field of a form.
   */
  heading?: string;
}) {
  const t = useTranslations('attachments');
  return (
    <div
      data-testid="attachments-header"
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      {heading ? (
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {heading}
        </h2>
      ) : (
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('title')}
        </span>
      )}
      <div
        data-testid="attachments-actions"
        className="grid grid-cols-2 gap-2 sm:flex sm:items-center"
      >
        {children}
      </div>
    </div>
  );
}

/** The Add-attachment button plus its hidden file input, shared by both modes. */
function UploadControl({
  onFileSelected,
  loading,
  disabled,
}: {
  onFileSelected: (file: File) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('attachments');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file after an error/removal.
    event.target.value = '';
    if (file) onFileSelected(file);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        isLoading={loading}
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        {t('upload')}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_ATTACHMENT_TYPES.join(',')}
        className="hidden"
        aria-label={t('upload')}
        onChange={handleChange}
      />
    </>
  );
}

/**
 * The kind picker a warranty's upload carries. The choice applies to the next
 * file added or scanned, so it sits beside the controls rather than on a row.
 */
function DocumentKindPicker({
  value,
  onChange,
  disabled,
}: {
  value: DocumentKind;
  onChange: (kind: DocumentKind) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('warranties');
  return (
    <div className="sm:max-w-xs">
      <Select
        id="attachment-document-kind"
        label={t('documents.kindLabel')}
        value={value}
        disabled={disabled}
        options={DOCUMENT_KINDS.map((kind) => ({
          value: kind,
          label: t(`documents.kinds.${kind}`),
        }))}
        onChange={(event) => onChange(event.target.value as DocumentKind)}
      />
    </div>
  );
}

/**
 * Lists, uploads, and deletes the saved attachments of one parent: a
 * transaction, or a warranty (whose rows also say what kind of document each
 * one is).
 */
function SavedAttachments({
  parentKind,
  parentId,
  initialDocumentKind,
}: {
  parentKind: SavedParentKind;
  parentId: string;
  initialDocumentKind?: DocumentKind;
}) {
  const t = useTranslations('attachments');
  const tw = useTranslations('warranties');
  const { formatBytes } = useNumberFormat();
  const isWarranty = parentKind === 'warranty';
  const parent = useMemo<AttachmentParent>(
    () =>
      parentKind === 'warranty'
        ? { warrantyId: parentId }
        : { transactionId: parentId },
    [parentKind, parentId],
  );
  const [documentKind, setDocumentKind] = useState<DocumentKind>(
    initialDocumentKind ?? DEFAULT_DOCUMENT_KIND,
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [erroredImages, setErroredImages] = useState<Record<string, boolean>>(
    {},
  );
  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** The photo currently in the scan dialog, or null when it is closed. */
  const [scanning, setScanning] = useState<File | null>(null);
  /**
   * The attachment open in the preview, or null when it is closed.
   *
   * The whole target is held here rather than composed in the JSX, so it keeps
   * one identity for as long as it is on screen -- an object rebuilt on every
   * render of this list is a different subject to anything downstream.
   */
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const load = useCallback(() => {
    // The writes live in the inner function so they run after the request,
    // not during the effect that starts it.
    const run = async () => {
      try {
        const list = await attachmentsApi.list(parent);
        setAttachments(list);
      } catch (error) {
        toast.error(getErrorMessage(error, t('loadFailed')));
      }
    };
    return run();
  }, [parent, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFileSelected = async (file: File) => {
    const error = validateSelection(file, attachments.length, t, formatBytes);
    if (error) {
      toast.error(error);
      return;
    }
    await upload(file);
  };

  const upload = async (file: File, original?: File) => {
    setUploading(true);
    try {
      // A transaction's upload carries no kind: its route takes none (W4).
      if (isWarranty) {
        await attachmentsApi.upload(parent, file, original, documentKind);
      } else {
        await attachmentsApi.upload(parent, file, original);
      }
      toast.success(t('uploaded'));
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, t('uploadFailed')));
    } finally {
      setUploading(false);
    }
  };

  /**
   * A photo picked for scanning is checked against the cap, and against
   * nothing else about the file.
   *
   * Neither its size nor its type says whether the scan can be attached: what
   * gets attached is the dialog's output, a JPEG capped at `OUTPUT_MAX_EDGE`,
   * so a HEIC is scannable and so is a 14 MB photo from a recent phone. The
   * size rule applied here refused exactly the captures this feature exists
   * for, and it made the dialog's own "the original is too large to keep"
   * path unreachable outside its unit test.
   */
  const handleScanSelected = (file: File) => {
    if (attachments.length >= MAX_ATTACHMENTS_PER_TRANSACTION) {
      toast.error(t('tooMany', { max: MAX_ATTACHMENTS_PER_TRANSACTION }));
      return;
    }
    setScanning(file);
  };

  const openScanPicker = useRef<(() => void) | null>(null);
  const rememberScanPicker = useCallback((open: () => void) => {
    openScanPicker.current = open;
  }, []);

  // Retake is not Cancel: it closes the review and asks for another photo.
  // Wired to the same close, the two buttons did exactly the same thing.
  const handleScanRetake = useCallback(() => {
    setScanning(null);
    openScanPicker.current?.();
  }, []);

  const handleScanAccepted = async (outcome: ScanOutcome) => {
    setScanning(null);
    await upload(outcome.file, outcome.original);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await attachmentsApi.delete(deleteTarget.id);
      toast.success(t('deleted'));
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, t('deleteFailed')));
    } finally {
      setDeleting(false);
    }
  };

  const atLimit = attachments.length >= MAX_ATTACHMENTS_PER_TRANSACTION;

  return (
    <div className="space-y-2">
      <AttachmentsHeader
        heading={isWarranty ? tw('documents.title') : undefined}
      >
        <ScanDocumentControl
          onFileSelected={handleScanSelected}
          onReady={rememberScanPicker}
          disabled={uploading || atLimit}
        />
        <UploadControl
          onFileSelected={handleFileSelected}
          loading={uploading}
          disabled={uploading || atLimit}
        />
      </AttachmentsHeader>

      {isWarranty && (
        <DocumentKindPicker
          value={documentKind}
          onChange={setDocumentKind}
          disabled={uploading}
        />
      )}

      {attachments.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {isWarranty ? tw('documents.empty') : t('empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((attachment) => {
            const isImage = attachment.contentType.startsWith('image/');
            const showThumb = isImage && !erroredImages[attachment.id];
            return (
              <li
                key={attachment.id}
                className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-gray-700 p-2"
              >
                {/* The row is the preview trigger: thumbnail, name and size
                    in one button, with the filename as its accessible name.
                    Delete stays a sibling -- a control inside a button is
                    a control nobody can reach. */}
                <button
                  type="button"
                  onClick={() => setPreview({ kind: 'saved', attachment })}
                  aria-label={t('preview.open', { name: attachment.filename })}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {showThumb ? (
                    // Served from our own backend; next/image adds no value and
                    // cannot follow the onError fallback.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachmentDownloadUrl(attachment.id)}
                      alt=""
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded object-cover"
                      onError={() =>
                        setErroredImages((prev) => ({
                          ...prev,
                          [attachment.id]: true,
                        }))
                      }
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-700 text-lg"
                    >
                      {attachment.contentType === 'application/pdf' ? '📄' : '📎'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-blue-600 dark:text-blue-400 hover:underline">
                      {attachment.filename}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {formatBytes(attachment.byteSize)}
                    </span>
                  </span>
                </button>
                {isWarranty && (
                  <Badge
                    variant="gray"
                    data-testid={`document-kind-${attachment.id}`}
                    className="shrink-0"
                  >
                    {tw(`documents.kinds.${attachment.documentKind}`)}
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('delete')}
                  className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                  onClick={() => setDeleteTarget(attachment)}
                >
                  {t('delete')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <DocumentScanDialog
        isOpen={scanning !== null}
        file={scanning}
        onCancel={() => setScanning(null)}
        // Retake closes the dialog and leaves the control ready: the input is
        // cleared after every pick, so choosing the same photo again works.
        onRetake={handleScanRetake}
        onAccept={handleScanAccepted}
      />

      <AttachmentPreviewDialog
        isOpen={preview !== null}
        target={preview}
        onClose={() => setPreview(null)}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t('deleteConfirmTitle')}
        message={t('deleteConfirmMessage', { name: deleteTarget?.filename ?? '' })}
        confirmLabel={t('delete')}
        variant="danger"
        pushHistory
        onConfirm={handleDelete}
        onCancel={() => (deleting ? undefined : setDeleteTarget(null))}
      />
    </div>
  );
}

/**
 * Holds files client-side for a transaction that does not exist yet. Selected
 * files are validated the same way as saved uploads and previewed locally; the
 * parent form uploads them once it has created the transaction.
 */
function StagedAttachments({
  files,
  onChange,
}: {
  files: StagedAttachment[];
  onChange: (files: StagedAttachment[]) => void;
}) {
  const t = useTranslations('attachments');
  const { formatBytes } = useNumberFormat();
  const [scanning, setScanning] = useState<File | null>(null);
  /** The staged entry open in the preview, or null when it is closed. */
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  // Object URLs for image previews, recreated whenever the file list changes
  // and revoked on cleanup so blobs are not leaked. Guarded for environments
  // (jsdom) where createObjectURL is unavailable.
  const previews = useMemo(
    () =>
      files.map(({ file }) =>
        file.type.startsWith('image/') &&
        typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(file)
          : null,
      ),
    [files],
  );
  useEffect(
    () => () => {
      previews.forEach(
        (url) =>
          url && typeof URL.revokeObjectURL === 'function' &&
          URL.revokeObjectURL(url),
      );
    },
    [previews],
  );

  const handleFileSelected = (file: File) => {
    const error = validateSelection(file, files.length, t, formatBytes);
    if (error) {
      toast.error(error);
      return;
    }
    onChange([...files, { file }]);
  };

  /** Same admission as the saved list: the cap, and nothing about the photo. */
  const handleScanSelected = (file: File) => {
    if (files.length >= MAX_ATTACHMENTS_PER_TRANSACTION) {
      toast.error(t('tooMany', { max: MAX_ATTACHMENTS_PER_TRANSACTION }));
      return;
    }
    setScanning(file);
  };

  const openScanPicker = useRef<(() => void) | null>(null);
  const rememberScanPicker = useCallback((open: () => void) => {
    openScanPicker.current = open;
  }, []);

  // Retake is not Cancel: it closes the review and asks for another photo.
  // Wired to the same close, the two buttons did exactly the same thing.
  const handleScanRetake = useCallback(() => {
    setScanning(null);
    openScanPicker.current?.();
  }, []);

  const handleScanAccepted = (outcome: ScanOutcome) => {
    setScanning(null);
    // The pair is staged as one entry, so it counts once against the cap and
    // is uploaded in one request when the transaction is created.
    onChange([...files, { file: outcome.file, original: outcome.original }]);
  };

  const removeAt = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
  };

  const atLimit = files.length >= MAX_ATTACHMENTS_PER_TRANSACTION;

  return (
    <div className="space-y-2">
      <AttachmentsHeader>
        <ScanDocumentControl
          onFileSelected={handleScanSelected}
          onReady={rememberScanPicker}
          disabled={atLimit}
        />
        <UploadControl
          onFileSelected={handleFileSelected}
          disabled={atLimit}
        />
      </AttachmentsHeader>

      {files.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('empty')}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {files.map(({ file, original }, index) => {
              const thumbnail = previews[index];
              return (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-gray-700 p-2"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setPreview({ kind: 'file', file, original })
                    }
                    aria-label={t('preview.open', { name: file.name })}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnail}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-700 text-lg"
                      >
                        {file.type === 'application/pdf' ? '📄' : '📎'}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-900 dark:text-gray-100">
                        {file.name}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatBytes(file.size)}
                        {original ? ` · ${t('scan.originalKept')}` : ''}
                      </span>
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('remove')}
                    onClick={() => removeAt(index)}
                  >
                    {t('remove')}
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('pendingHint')}
          </p>
        </>
      )}

      <DocumentScanDialog
        isOpen={scanning !== null}
        file={scanning}
        onCancel={() => setScanning(null)}
        onRetake={handleScanRetake}
        onAccept={handleScanAccepted}
      />

      <AttachmentPreviewDialog
        isOpen={preview !== null}
        target={preview}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

/**
 * Attachment manager for a transaction or a warranty. Renders in saved mode
 * when a transaction or warranty id is supplied, or in staged mode
 * (client-side only) when given a pending file list and change handler.
 *
 * A warranty's documents are this component with a warranty parent, never a
 * second uploader: the limits, the scan pair and the preview are the same.
 */
export function AttachmentsSection(props: AttachmentsSectionProps) {
  if ('transactionId' in props) {
    return (
      <SavedAttachments
        key={`transaction:${props.transactionId}`}
        parentKind="transaction"
        parentId={props.transactionId}
      />
    );
  }
  if ('warrantyId' in props) {
    return (
      <SavedAttachments
        key={`warranty:${props.warrantyId}`}
        parentKind="warranty"
        parentId={props.warrantyId}
        initialDocumentKind={props.documentKind}
      />
    );
  }
  return (
    <StagedAttachments
      files={props.stagedFiles}
      onChange={props.onStagedFilesChange}
    />
  );
}
