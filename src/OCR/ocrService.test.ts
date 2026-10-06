import { describe, expect, it, vi } from 'vitest';
import { performOCR } from './ocrService';

vi.mock('@/lib/tableSegmenter', () => ({
  detectTableGrid: vi.fn().mockResolvedValue({
    cells: [{ rowIdx: 0, colIdx: 0, x0: 0, y0: 0, x1: 10, y1: 10 }],
    rowBoundaries: [0, 10],
    colBoundaries: [0, 10],
    isInverted: false,
  }),
  renderToCanvas: vi.fn().mockResolvedValue({
    getContext: () => ({ drawImage: vi.fn() }),
  }),
  extractCellImage: vi.fn().mockReturnValue({
    dataUrl: 'data:image/png;base64,abc',
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

vi.mock('@/lib/dataCorrector', () => ({
  validateRow: vi.fn(),
  correctCellText: vi.fn(),
  validateDocument: vi.fn(),
}));

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
