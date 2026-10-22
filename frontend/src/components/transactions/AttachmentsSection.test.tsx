import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@/test/render';
import toast from 'react-hot-toast';
import { AttachmentsSection } from './AttachmentsSection';
import { attachmentsApi } from '@/lib/attachments';
import {
  Attachment,
  MAX_ATTACHMENT_BYTES,
  StagedAttachment,
} from '@/types/attachment';

/**
 * The scan dialog is replaced by a stub that reports the file it was given and
 * accepts on demand. Its own behaviour has its own suite; what is under test
 * here is the wiring -- which control opens it, what reaches the upload, and
 * how a pair is listed.
 */
vi.mock('./DocumentScanDialog', () => ({
  DocumentScanDialog: ({
    isOpen,
    file,
    onAccept,
    onRetake,
    onCancel,
  }: {
    isOpen: boolean;
    file: File | null;
    onAccept: (outcome: { file: File; original?: File }) => void;
    onRetake: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div data-testid="scan-dialog">
        <span data-testid="scan-source">{file?.name}</span>
        <button
          type="button"
          onClick={() =>
            onAccept({
              file: new File(['scan'], 'receipt-scan.jpg', {
                type: 'image/jpeg',
              }),
              original: file ?? undefined,
            })
          }
        >
          accept-pair
        </button>
        <button
          type="button"
          onClick={() =>
            onAccept({
              file: new File(['scan'], 'receipt-scan.jpg', {
                type: 'image/jpeg',
              }),
            })
          }
        >
          accept-scan-only
        </button>
        <button type="button" onClick={onRetake}>
          Retake
        </button>
        <button type="button" onClick={onCancel}>
          Cancel scan
        </button>
      </div>
    ) : null,
}));

/**
 * The preview dialog is likewise a stub that reports what it was asked to
 * show. Its own suite covers what it draws; here the question is which row
 * opens it and with what.
 */
vi.mock('./AttachmentPreviewDialog', () => ({
  AttachmentPreviewDialog: ({
    isOpen,
    target,
    onClose,
  }: {
    isOpen: boolean;
    target:
      | { kind: 'saved'; attachment: Attachment }
      | { kind: 'file'; file: File; original?: File }
      | null;
    onClose: () => void;
  }) =>
    isOpen && target ? (
      <div data-testid="preview-dialog">
        <span data-testid="preview-target">
          {target.kind === 'saved'
            ? `saved:${target.attachment.id}:${target.attachment.originalAttachmentId ?? 'none'}`
            : `file:${target.file.name}:${target.original?.name ?? 'none'}`}
        </span>
        <button type="button" onClick={onClose}>
          close-preview
        </button>
      </div>
    ) : null,
}));

// Spread the real module: a bare factory would blank `fetchBytes` and every
// other export for the whole tree under test.
vi.mock('@/lib/attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/attachments')>()),
  attachmentsApi: { list: vi.fn(), upload: vi.fn(), delete: vi.fn() },
}));

const mockList = attachmentsApi.list as ReturnType<typeof vi.fn>;
const mockUpload = attachmentsApi.upload as ReturnType<typeof vi.fn>;
const mockDelete = attachmentsApi.delete as ReturnType<typeof vi.fn>;

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'a-1',
    transactionId: 't-1',
    warrantyId: null,
    documentKind: 'other',
    filename: 'receipt.png',
    contentType: 'image/png',
    byteSize: 2048,
    sha256: 'abc',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

async function renderSection() {
  await act(async () => {
    render(<AttachmentsSection transactionId="t-1" />);
  });
}

function fileOfType(type: string, size = 100): File {
  const file = new File(['x'], 'f', { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('AttachmentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
  });

  it('stacks the title over two half-width buttons on a phone, in both modes', async () => {
    // Beside the title, Scan document and Add attachment overran a phone's
    // width. The header is a column there and a row from `sm` up, and the
    // buttons are grid cells that each take half the line.
    const expectHeaderLayout = () => {
      const header = screen.getByTestId('attachments-header');
      expect(header.className).toContain('flex-col');
      expect(header.className).toContain('sm:flex-row');
      const actions = screen.getByTestId('attachments-actions');
      expect(actions.className).toContain('grid-cols-2');
      expect(actions.className).toContain('sm:flex');
      const buttons = Array.from(actions.querySelectorAll('button'));
      expect(buttons.map((b) => b.textContent)).toEqual([
        'Scan document',
        'Add attachment',
      ]);
      // The section title is not in the button row: it has a line of its own.
      expect(actions.textContent).not.toContain('Attachments');
      expect(header.textContent).toContain('Attachments');
    };

    await renderSection();
    expectHeaderLayout();
    cleanup();

    await act(async () => {
      render(<AttachmentsSection stagedFiles={[]} onStagedFilesChange={vi.fn()} />);
    });
    expectHeaderLayout();
  });

  it('shows the empty state when there are no attachments', async () => {
    await renderSection();
    expect(screen.getByText('No attachments yet')).toBeInTheDocument();
  });

  it('previews an attachment when its row is clicked, and downloads nothing', async () => {
    mockList.mockResolvedValue([makeAttachment()]);
    await renderSection();

    // The row is a button, not a download link: preview is the default action.
    expect(screen.queryByRole('link', { name: 'receipt.png' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('preview-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview receipt.png' }));
    expect(screen.getByTestId('preview-target')).toHaveTextContent('saved:a-1:none');

    fireEvent.click(screen.getByRole('button', { name: 'close-preview' }));
    expect(screen.queryByTestId('preview-dialog')).not.toBeInTheDocument();
  });

  it('keeps Delete outside the preview trigger', async () => {
    mockList.mockResolvedValue([makeAttachment()]);
    await renderSection();
    const trigger = screen.getByRole('button', { name: 'Preview receipt.png' });
    const remove = screen.getByRole('button', { name: 'Delete' });
    expect(trigger.contains(remove)).toBe(false);
  });

  it('reports failure to load', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    await renderSection();
    await act(async () => {});
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('uploads a valid file and refreshes', async () => {
    mockList.mockResolvedValue([]);
    mockUpload.mockResolvedValue(makeAttachment());
    await renderSection();

    const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [fileOfType('image/png')] } });
    });

    await waitFor(() =>
      // A plain upload carries no original: only a scan produces a pair, so
      // this path must never send a second file.
      expect(mockUpload).toHaveBeenCalledWith(
        { transactionId: 't-1' },
        expect.any(File),
        undefined,
      ),
    );
    expect(toast.success).toHaveBeenCalledWith('Attachment added');
    // Refreshed once on mount, once after upload.
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('rejects an unsupported file type without uploading', async () => {
    await renderSection();
    const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [fileOfType('text/plain')] },
      });
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('rejects a file over the size limit', async () => {
    await renderSection();
    const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [fileOfType('image/png', MAX_ATTACHMENT_BYTES + 1)],
        },
      });
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('deletes an attachment after confirmation', async () => {
    mockList.mockResolvedValue([makeAttachment()]);
    mockDelete.mockResolvedValue(undefined);
    await renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    // Confirm dialog appears; click its confirm action.
    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
    await act(async () => {
      fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    });

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('a-1'));
    expect(toast.success).toHaveBeenCalledWith('Attachment deleted');
  });

  describe('scanning a document', () => {
    const scanInput = () =>
      screen.getByLabelText('Scan document') as HTMLInputElement;

    function photo(size = 1024, type = 'image/jpeg'): File {
      const file = new File(['photo'], 'receipt.jpg', { type });
      Object.defineProperty(file, 'size', { value: size });
      return file;
    }

    it('offers scanning beside the plain upload', async () => {
      await renderSection();
      expect(
        screen.getByRole('button', { name: 'Scan document' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add attachment' }),
      ).toBeInTheDocument();
    });

    it('opens the dialog with the chosen photo', async () => {
      await renderSection();

      await act(async () => {
        fireEvent.change(scanInput(), { target: { files: [photo()] } });
      });

      expect(screen.getByTestId('scan-source')).toHaveTextContent('receipt.jpg');
    });

    it('uploads both halves in one request when a pair is accepted', async () => {
      mockUpload.mockResolvedValue(makeAttachment());
      await renderSection();
      await act(async () => {
        fireEvent.change(scanInput(), { target: { files: [photo()] } });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'accept-pair' }));
      });

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
      const [parent, file, original] = mockUpload.mock.calls[0];
      expect(parent).toEqual({ transactionId: 't-1' });
      expect((file as File).name).toBe('receipt-scan.jpg');
      expect((original as File).name).toBe('receipt.jpg');
    });

    it('uploads the scan alone when no original comes back', async () => {
      mockUpload.mockResolvedValue(makeAttachment());
      await renderSection();
      await act(async () => {
        fireEvent.change(scanInput(), { target: { files: [photo()] } });
      });

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'accept-scan-only' }),
        );
      });

      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
      expect(mockUpload.mock.calls[0][2]).toBeUndefined();
    });

    // What gets attached is the dialog's output, not the photo, so the photo's
    // own size decides nothing. Rejecting it here refused exactly the captures
    // the scanner exists for -- a 12MP phone photo is routinely over the
    // attachment limit and scans to a JPEG well under it -- and it made the
    // dialog's "the original is too large to keep" path unreachable outside
    // its own unit test.
    it('scans a photo larger than an attachment may be', async () => {
      await renderSection();

      await act(async () => {
        fireEvent.change(scanInput(), {
          target: { files: [photo(MAX_ATTACHMENT_BYTES + 1)] },
        });
      });

      expect(screen.getByTestId('scan-dialog')).toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });

    // Retake and Cancel both closed the dialog and nothing else, so the button
    // the user presses to take another photo left them hunting for the Scan
    // document button again.
    it('reopens the picker on Retake, and does not on Cancel', async () => {
      await renderSection();
      const opened = vi.spyOn(HTMLInputElement.prototype, 'click');

      await act(async () => {
        fireEvent.change(scanInput(), { target: { files: [photo()] } });
      });
      opened.mockClear();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
      });
      expect(screen.queryByTestId('scan-dialog')).not.toBeInTheDocument();
      expect(opened).toHaveBeenCalled();

      await act(async () => {
        fireEvent.change(scanInput(), { target: { files: [photo()] } });
      });
      opened.mockClear();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
      });
      expect(screen.queryByTestId('scan-dialog')).not.toBeInTheDocument();
      expect(opened).not.toHaveBeenCalled();
      opened.mockRestore();
    });

    // The scanner re-encodes its output as a JPEG, so a format that could not
    // be attached as-is is still worth scanning.
    it('accepts a photo whose own type is not an allowed attachment type', async () => {
      await renderSection();

      await act(async () => {
        fireEvent.change(scanInput(), {
          target: { files: [photo(1024, 'image/heic')] },
        });
      });

      expect(screen.getByTestId('scan-dialog')).toBeInTheDocument();
    });

    it('hands the preview the original id of a scanned attachment', async () => {
      mockList.mockResolvedValue([
        makeAttachment({
          id: 'scan-1',
          filename: 'receipt-scan.jpg',
          originalAttachmentId: 'orig-1',
        }),
      ]);
      await renderSection();

      // One row for the pair; the original is reached inside the preview.
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.queryByText('View original')).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: 'Preview receipt-scan.jpg' }),
      );
      expect(screen.getByTestId('preview-target')).toHaveTextContent(
        'saved:scan-1:orig-1',
      );
    });
  });

  describe('staged mode', () => {
    function renderStaged(files: StagedAttachment[], onChange = vi.fn()) {
      render(
        <AttachmentsSection stagedFiles={files} onStagedFilesChange={onChange} />,
      );
      return onChange;
    }

    it('does not touch the server and shows the empty state', () => {
      renderStaged([]);
      expect(screen.getByText('No attachments yet')).toBeInTheDocument();
      expect(mockList).not.toHaveBeenCalled();
    });

    it('stages a valid file via the change handler without uploading', () => {
      const onChange = renderStaged([]);
      const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
      const file = fileOfType('image/png');
      fireEvent.change(input, { target: { files: [file] } });

      // Staged as a pair-shaped entry with no original: an ordinary upload is
      // one file, and the shape is what the create-time loop reads.
      expect(onChange).toHaveBeenCalledWith([{ file }]);
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it('rejects an unsupported staged file', () => {
      const onChange = renderStaged([]);
      const input = screen.getByLabelText('Add attachment') as HTMLInputElement;
      fireEvent.change(input, {
        target: { files: [fileOfType('text/plain')] },
      });

      expect(onChange).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });

    it('stages a scanned pair as one entry', () => {
      const onChange = renderStaged([]);
      const photo = fileOfType('image/jpeg');
      Object.defineProperty(photo, 'name', { value: 'receipt.jpg' });

      fireEvent.change(screen.getByLabelText('Scan document'), {
        target: { files: [photo] },
      });
      fireEvent.click(screen.getByRole('button', { name: 'accept-pair' }));

      // One entry carrying both halves: it counts once against the cap, and
      // the create-time loop uploads both in a single request.
      expect(onChange).toHaveBeenCalledTimes(1);
      const staged = onChange.mock.calls[0][0] as StagedAttachment[];
      expect(staged).toHaveLength(1);
      expect(staged[0].file.name).toBe('receipt-scan.jpg');
      expect(staged[0].original?.name).toBe('receipt.jpg');
    });

    it('marks a staged pair as keeping its original', () => {
      const scan = fileOfType('image/jpeg');
      Object.defineProperty(scan, 'name', { value: 'receipt-scan.jpg' });
      const original = fileOfType('image/jpeg');
      renderStaged([{ file: scan, original }]);

      expect(screen.getByText(/original kept/i)).toBeInTheDocument();
    });

    it('previews a staged file, with the photo it was scanned from', () => {
      const scan = fileOfType('image/jpeg');
      Object.defineProperty(scan, 'name', { value: 'receipt-scan.jpg' });
      const original = fileOfType('image/jpeg');
      Object.defineProperty(original, 'name', { value: 'receipt.jpg' });
      renderStaged([{ file: scan, original }]);

      fireEvent.click(
        screen.getByRole('button', { name: 'Preview receipt-scan.jpg' }),
      );
      expect(screen.getByTestId('preview-target')).toHaveTextContent(
        'file:receipt-scan.jpg:receipt.jpg',
      );
    });

    it('lists staged files with a remove control', () => {
      const file = fileOfType('application/pdf');
      Object.defineProperty(file, 'name', { value: 'invoice.pdf' });
      const onChange = renderStaged([{ file }]);

      expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(onChange).toHaveBeenCalledWith([]);
    });
  });

  describe('with a warranty parent', () => {
    async function renderWarranty(documentKind?: 'receipt' | 'manual' | 'photo' | 'other') {
      await act(async () => {
        render(<AttachmentsSection warrantyId="w-1" documentKind={documentKind} />);
      });
    }

    const warrantyDoc = (overrides: Partial<Attachment> = {}) =>
      makeAttachment({
        transactionId: null,
        warrantyId: 'w-1',
        documentKind: 'manual',
        filename: 'manual.pdf',
        contentType: 'application/pdf',
        ...overrides,
      });

    it("lists the warranty's documents with each one's kind", async () => {
      mockList.mockResolvedValue([warrantyDoc()]);
      await renderWarranty();
      expect(mockList).toHaveBeenCalledWith({ warrantyId: 'w-1' });
      expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
      expect(screen.getByTestId('document-kind-a-1')).toHaveTextContent('Manual');
      expect(
        screen.getByRole('button', { name: 'Preview manual.pdf' }),
      ).toBeInTheDocument();
    });

    it('says there are no documents yet when the list is empty', async () => {
      mockList.mockResolvedValue([]);
      await renderWarranty();
      expect(screen.getByText('No documents yet')).toBeInTheDocument();
    });

    it('uploads with the kind chosen, Other until one is', async () => {
      mockList.mockResolvedValue([]);
      mockUpload.mockResolvedValue(warrantyDoc());
      await renderWarranty();

      const kind = screen.getByLabelText('Document type') as HTMLSelectElement;
      expect(kind.value).toBe('other');
      fireEvent.change(kind, { target: { value: 'receipt' } });

      await act(async () => {
        fireEvent.change(screen.getByLabelText('Add attachment'), {
          target: { files: [fileOfType('application/pdf')] },
        });
      });
      await waitFor(() =>
        expect(mockUpload).toHaveBeenCalledWith(
          { warrantyId: 'w-1' },
          expect.any(File),
          undefined,
          'receipt',
        ),
      );
    });

    it('starts the picker on the kind the caller names', async () => {
      mockList.mockResolvedValue([]);
      await renderWarranty('photo');
      expect((screen.getByLabelText('Document type') as HTMLSelectElement).value).toBe('photo');
    });

    it('uploads a scanned pair under the warranty with its kind', async () => {
      mockList.mockResolvedValue([]);
      mockUpload.mockResolvedValue(warrantyDoc());
      await renderWarranty('receipt');
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Scan document'), {
          target: { files: [fileOfType('image/jpeg')] },
        });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'accept-pair' }));
      });
      await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
      const [parent, file, original, documentKind] = mockUpload.mock.calls[0];
      expect(parent).toEqual({ warrantyId: 'w-1' });
      expect((file as File).name).toBe('receipt-scan.jpg');
      expect(original).toBeInstanceOf(File);
      expect(documentKind).toBe('receipt');
    });

    it('previews a document rather than downloading it', async () => {
      mockList.mockResolvedValue([warrantyDoc()]);
      await renderWarranty();
      fireEvent.click(screen.getByRole('button', { name: 'Preview manual.pdf' }));
      expect(screen.getByTestId('preview-target')).toHaveTextContent('saved:a-1:none');
    });

    it('leaves the transaction list exactly as it was: no kind picker, no kind badge', async () => {
      mockList.mockResolvedValue([makeAttachment()]);
      await renderSection();
      expect(mockList).toHaveBeenCalledWith({ transactionId: 't-1' });
      expect(screen.queryByLabelText('Document type')).not.toBeInTheDocument();
      expect(screen.queryByTestId('document-kind-a-1')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Documents' })).not.toBeInTheDocument();
      expect(screen.getByText('Attachments')).toBeInTheDocument();
    });
  });
});
