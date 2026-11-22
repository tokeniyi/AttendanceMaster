import { describe, expect, it, vi } from 'vitest';
import { performOCR, prewarmOCR, shutdownOCR } from './ocrService';

vi.mock('@/lib/tableSegmenter', () => ({
  detectTableGrid: vi.fn().mockResolvedValue({
    cells: [{ rowIdx: 0, colIdx: 0, x0: 0, y0: 0, x1: 10, y1: 10 }],
    rowBoundaries: [0, 10],
    colBoundaries: [0, 10],
    isInverted: false,
  }),
  loadImage: vi.fn().mockResolvedValue({ naturalWidth: 10, naturalHeight: 10 }),
  renderToCanvas: vi.fn().mockResolvedValue({
    getContext: () => ({ drawImage: vi.fn() }),
  }),
  extractCellImage: vi.fn().mockReturnValue({
    image: { width: 10, height: 10 },
    analysis: { isEmpty: false },
  }),
}));

vi.mock('@/lib/semanticAnalyzer', () => ({
  classifyRow: vi.fn((row: any) => row),
  inferColumnSchema: vi.fn().mockReturnValue([{ inferredType: 'name' }]),
  analyseDocument: vi.fn().mockReturnValue({
    rows: [
      { text: 'Ada Lovelace', columns: ['Ada Lovelace'], region: 'data' },
    ],
  }),
}));

vi.mock('@/lib/dataCorrector', () => {
  const validateRow = vi.fn();
  return {
    validateRow,
    correctCellText: vi.fn(),
    validateDocument: vi.fn(),
    // performOCR calls finalizeRowColumns (backlog #7), which in the real module
    // delegates to validateRow. A module-internal call can't be intercepted by
    // mocking validateRow alone, so this stand-in mirrors that delegation and
    // keeps the test's validateRow mock in the loop.
    finalizeRowColumns: vi.fn(
      (
        rawColumns: string[],
        expectedCols: number,
        colTypes: string[] | undefined,
        avgConfidence: number,
        healedColumns: string[] | null = null,
      ) => {
        const validation = validateRow(healedColumns ?? rawColumns, expectedCols, colTypes);
        return {
          columns: validation.correctedColumns,
          issues: validation.issues,
          needsFallback: healedColumns === null && (!validation.isValid || avgConfidence < 75),
        };
      },
    ),
  };
});

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(() => ({
    setParameters: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn().mockResolvedValue({ data: { text: ' ada lovelace ', confidence: 65 } }),
    terminate: vi.fn().mockResolvedValue(undefined),
  })),
  createScheduler: vi.fn(() => ({
    addWorker: vi.fn(),
    addJob: vi.fn().mockImplementation(() => ({ data: { text: ' ada lovelace ', confidence: 65 } })),
    terminate: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('performOCR correction contract', () => {
  it('applies validateRow corrections even when fallback healing does not run', async () => {
    const { validateRow } = await import('@/lib/dataCorrector');
    (validateRow as any).mockImplementation((cols: string[]) => ({
      isValid: false,
      issues: ['Missing 1 column(s)'],
      correctedColumns: cols.map((c: string) =>
        c ? c.replace(/\b\w/g, (m: string) => m.toUpperCase()) : c
      ),
    }));

    const result = await performOCR('data:image/png;base64,abc', undefined);
    expect(validateRow).toHaveBeenCalled();
    expect(result[0].text).toBe('Ada Lovelace');
  });
});

describe('OCR worker pool', () => {
  it('reuses warm workers across scans instead of recreating them', async () => {
    const { createWorker } = await import('tesseract.js');
    await shutdownOCR();
    (createWorker as any).mockClear();

    await performOCR('data:image/png;base64,abc');
    const afterFirst = (createWorker as any).mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await performOCR('data:image/png;base64,abc');
    expect((createWorker as any).mock.calls.length).toBe(afterFirst);
    await shutdownOCR();
  });

  it('loads the self-hosted LSTM model and cores', async () => {
    const { createWorker } = await import('tesseract.js');
    await shutdownOCR();
    (createWorker as any).mockClear();
    prewarmOCR();
    await performOCR('data:image/png;base64,abc');
    const [lang, oem, opts] = (createWorker as any).mock.calls[0];
    expect(lang).toBe('eng');
    expect(oem).toBe(1);
    expect(opts).toMatchObject({ corePath: '/tesseract', langPath: '/tesseract/lang', workerBlobURL: false });
    await shutdownOCR();
  });

  it('rebuilds the pool after a failed worker start', async () => {
    const { createWorker } = await import('tesseract.js');
    await shutdownOCR();
    (createWorker as any).mockClear();
    (createWorker as any).mockImplementationOnce(() => Promise.reject(new Error('wasm failed')));
    await expect(performOCR('data:image/png;base64,abc')).rejects.toThrow('wasm failed');
    const result = await performOCR('data:image/png;base64,abc');
    expect(result[0].text).toBe('Ada Lovelace');
    await shutdownOCR();
  });
});
