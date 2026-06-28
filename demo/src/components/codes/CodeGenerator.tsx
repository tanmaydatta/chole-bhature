import { useState } from 'react';
import { generateCodes, previewExample, toCSV, downloadCSV } from '../../lib/codes';

type UsesOption = 'single' | 'up-to-5' | 'unlimited';

const USES_LABELS: Record<UsesOption, string> = {
  'single': 'Single use',
  'up-to-5': 'Up to 5 uses',
  'unlimited': 'Unlimited',
};

function usesLeft(option: UsesOption): number | '∞' {
  if (option === 'single') return 1;
  if (option === 'up-to-5') return 5;
  return '∞';
}

interface CodeGeneratorProps {
  onGenerated?: (codes: string[]) => void;
}

export function CodeGenerator({ onGenerated }: CodeGeneratorProps) {
  const [count, setCount] = useState<number>(500);
  const [uses, setUses] = useState<UsesOption>('single');
  const [prefix, setPrefix] = useState('ACME-');
  const [length, setLength] = useState<number>(5);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);

  const example = previewExample(prefix, length);

  function handleGenerate() {
    const safeCount = Math.max(1, Math.min(5000, count || 1));
    const safeLength = Math.max(3, Math.min(10, length || 5));
    const codes = generateCodes({ prefix, length: safeLength, count: safeCount });
    setGeneratedCodes(codes);
    setHasGenerated(true);
    onGenerated?.(codes);
  }

  function handleDownload() {
    if (!generatedCodes.length) return;
    const csv = toCSV(generatedCodes);
    downloadCSV('acme-affiliate-codes.csv', csv);
  }

  const previewCodes = generatedCodes.slice(0, 8);
  const moreCount = generatedCodes.length - 8;

  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h2 className="text-[16px] font-[700] mb-[4px]">Generate unique codes</h2>
        <p className="text-[13px] text-[var(--muted)] mb-0">
          Each code carries the eligibility &amp; discount you just set. Generate a batch and hand the CSV to your partner to distribute.
        </p>
      </div>

      {/* Controls grid */}
      <div className="flex gap-[14px] flex-wrap">
        <div className="flex flex-col gap-[6px]">
          <label
            htmlFor="code-count"
            className="text-[13px] font-[600] text-[var(--muted)]"
          >
            How many codes?
          </label>
          <input
            id="code-count"
            type="number"
            min={1}
            max={5000}
            className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[11px] py-[8px] text-[14px] text-[var(--ink)] w-[140px]"
            value={count}
            onChange={e => setCount(Number(e.target.value))}
          />
          <span className="text-[12px] text-[var(--muted)]">1 – 5,000</span>
        </div>

        <div className="flex flex-col gap-[6px]">
          <label
            htmlFor="uses-per-code"
            className="text-[13px] font-[600] text-[var(--muted)]"
          >
            Uses per code
          </label>
          <select
            id="uses-per-code"
            className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[11px] py-[8px] text-[14px] text-[var(--ink)] w-[140px]"
            value={uses}
            onChange={e => setUses(e.target.value as UsesOption)}
          >
            <option value="single">{USES_LABELS['single']}</option>
            <option value="up-to-5">{USES_LABELS['up-to-5']}</option>
            <option value="unlimited">{USES_LABELS['unlimited']}</option>
          </select>
          <span className="text-[12px] text-[var(--muted)]">Single-use is typical for giveaways</span>
        </div>
      </div>

      {/* Code pattern */}
      <div className="flex flex-col gap-[6px]">
        <label className="text-[13px] font-[600] text-[var(--muted)]">Code pattern</label>
        <div className="flex items-center gap-[8px] flex-wrap">
          <span className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[11px] py-[8px] font-[600] text-[var(--muted)]">
            Prefix
          </span>
          <input
            id="code-prefix"
            type="text"
            className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[11px] py-[8px] text-[14px] text-[var(--ink)] w-[110px] font-mono uppercase"
            value={prefix}
            onChange={e => setPrefix(e.target.value.toUpperCase())}
          />
          <span className="text-[var(--muted)]">+</span>
          <input
            id="code-length"
            type="number"
            min={3}
            max={10}
            className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[11px] py-[8px] text-[14px] text-[var(--ink)] w-[64px]"
            value={length}
            onChange={e => setLength(Number(e.target.value))}
          />
          <span className="border border-[var(--border)] bg-[var(--bg)] rounded-[8px] px-[11px] py-[8px] font-[600] text-[var(--muted)]">
            random chars (A–Z, 0–9)
          </span>
        </div>
        <div className="text-[13px] text-[var(--muted)] mt-[5px]">
          Example:{' '}
          <code
            className="px-[8px] py-[2px] rounded-[6px] font-[700]"
            style={{ background: 'var(--aff-bg, #f1ebfe)', color: 'var(--aff, #7c3aed)' }}
          >
            {example}
          </code>
        </div>
      </div>

      {/* Generate bar */}
      <div
        className="flex items-center gap-[12px] px-[14px] py-[14px] rounded-[11px]"
        style={{
          border: '1px dashed var(--aff, #7c3aed)',
          background: 'var(--aff-bg, #f1ebfe)',
        }}
      >
        <span className="font-[650]" style={{ color: 'var(--aff, #7c3aed)' }}>
          ⚡ Ready to generate
        </span>
        <span className="text-[13px] text-[var(--muted)]">
          — click to create the batch, then download the CSV.
        </span>
        <button
          className="ml-auto border-none px-[15px] py-[8px] rounded-[8px] font-[600] text-[13px] cursor-pointer text-white"
          style={{ background: 'var(--aff, #7c3aed)' }}
          onClick={handleGenerate}
        >
          Generate codes
        </button>
      </div>

      {/* Result preview */}
      {hasGenerated && (
        <div className="flex flex-col gap-[10px]">
          <div className="flex items-center justify-between">
            <div
              className="flex items-center gap-[8px] font-[650]"
              style={{ color: 'var(--green, #0f9d58)' }}
            >
              ✓ {generatedCodes.length.toLocaleString()} unique codes generated
            </div>
            <button
              className="border-none px-[15px] py-[8px] rounded-[8px] font-[600] text-[13px] cursor-pointer text-white"
              style={{ background: 'var(--aff, #7c3aed)' }}
              disabled={!hasGenerated}
              onClick={handleDownload}
            >
              ⬇ Download CSV
            </button>
          </div>

          <div className="border border-[var(--border)] rounded-[10px] overflow-hidden">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="text-left text-[10.5px] tracking-wide uppercase text-[var(--faint,#9aa4b2)] font-[700] px-[14px] py-[9px] border-b border-[var(--border)] bg-[var(--bg)]">
                    #
                  </th>
                  <th className="text-left text-[10.5px] tracking-wide uppercase text-[var(--faint,#9aa4b2)] font-[700] px-[14px] py-[9px] border-b border-[var(--border)] bg-[var(--bg)]">
                    Code
                  </th>
                  <th className="text-left text-[10.5px] tracking-wide uppercase text-[var(--faint,#9aa4b2)] font-[700] px-[14px] py-[9px] border-b border-[var(--border)] bg-[var(--bg)]">
                    Status
                  </th>
                  <th className="text-left text-[10.5px] tracking-wide uppercase text-[var(--faint,#9aa4b2)] font-[700] px-[14px] py-[9px] border-b border-[var(--border)] bg-[var(--bg)]">
                    Uses left
                  </th>
                </tr>
              </thead>
              <tbody>
                {previewCodes.map((code, i) => (
                  <tr key={code} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-[14px] py-[9px] tabular-nums">{i + 1}</td>
                    <td className="px-[14px] py-[9px]">
                      <code className="font-[650]">{code}</code>
                    </td>
                    <td
                      className="px-[14px] py-[9px] font-[600]"
                      style={{ color: 'var(--green, #0f9d58)' }}
                    >
                      Unused
                    </td>
                    <td className="px-[14px] py-[9px]">{String(usesLeft(uses))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {moreCount > 0 && (
              <div className="text-[12.5px] text-[var(--muted)] px-[14px] py-[9px]">
                + {moreCount.toLocaleString()} more in the CSV
              </div>
            )}
          </div>
        </div>
      )}

      {/* Download button (shown before generating too, but disabled) */}
      {!hasGenerated && (
        <div className="flex justify-end">
          <button
            className="border-none px-[15px] py-[8px] rounded-[8px] font-[600] text-[13px] text-white"
            style={{ background: 'var(--aff, #7c3aed)', opacity: 0.4, cursor: 'not-allowed' }}
            disabled
            aria-disabled="true"
          >
            ⬇ Download CSV
          </button>
        </div>
      )}
    </div>
  );
}
