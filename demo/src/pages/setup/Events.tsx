import { useState } from 'react';
import { EVENTS } from '../../data/events';
import { PageHeader } from '../../components/common/PageHeader';

export default function Events() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const event = EVENTS[selectedIdx];

  const sampleEntries = Object.entries(event.sample);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <PageHeader
          title="Events"
          action={
            <button className="border-none px-[14px] py-[8px] rounded-[8px] font-semibold text-[13px] cursor-pointer bg-[var(--accent)] text-white">
              ＋ New event
            </button>
          }
        />
      </div>

      <div className="flex gap-5 items-start">
        {/* Left: event list */}
        <div className="w-[260px] flex-shrink-0 flex flex-col gap-2">
          {EVENTS.map((ev, i) => (
            <div
              key={ev.name}
              onClick={() => setSelectedIdx(i)}
              className={`bg-[var(--panel)] border rounded-[11px] px-[13px] py-[12px] cursor-pointer shadow-[var(--shadow)] ${
                i === selectedIdx
                  ? 'border-[var(--accent)] shadow-[0_0_0_2px_var(--accent-soft)]'
                  : 'border-[var(--border)]'
              }`}
            >
              <div className="font-[650] flex items-center gap-[7px]">
                <span>⚡</span>
                <span>{ev.name}</span>
                {ev.live && (
                  <span className="ml-auto text-[10.5px] font-bold text-[var(--green)] bg-[var(--green-bg)] px-[7px] py-[1px] rounded-full">
                    ● receiving
                  </span>
                )}
              </div>
              <div className="text-[12px] text-[var(--muted)] mt-1">{ev.description}</div>
            </div>
          ))}
        </div>

        {/* Right: detail pane */}
        <div className="flex-1 min-w-0 bg-[var(--panel)] border border-[var(--border)] rounded-[14px] shadow-[var(--shadow)] p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <h2 className="m-0 text-[18px] font-mono">{event.name}</h2>
            <button className="border-none px-[12px] py-[6px] rounded-[8px] font-semibold text-[13px] cursor-pointer bg-[var(--hover)] text-[var(--ink)]">
              Edit
            </button>
          </div>

          {/* Subtitle */}
          <div className="text-[var(--muted)] text-[13px] mb-4">
            {event.description} · used in{' '}
            <strong className="text-[var(--ink)]">
              {event.usedIn} loyalty program{event.usedIn === 1 ? '' : 's'}
            </strong>
            {event.live ? (
              <>
                {' · '}last received <strong className="text-[var(--ink)]">2 min ago</strong>
              </>
            ) : (
              <>
                {' · '}
                <strong className="text-[var(--ink)]">no events yet</strong>
              </>
            )}
          </div>

          {/* Payload schema section label */}
          <div className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold mt-4 mb-2">
            Payload schema — each field becomes a variable
          </div>

          {/* Payload schema table */}
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[10px] overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-[10.5px] tracking-[0.05em] uppercase text-[var(--faint)] font-bold px-[12px] py-[9px] border-b border-[var(--border)]">
                    Field
                  </th>
                  <th className="text-left text-[10.5px] tracking-[0.05em] uppercase text-[var(--faint)] font-bold px-[12px] py-[9px] border-b border-[var(--border)]">
                    Type
                  </th>
                  <th className="text-left text-[10.5px] tracking-[0.05em] uppercase text-[var(--faint)] font-bold px-[12px] py-[9px] border-b border-[var(--border)]">
                    Required
                  </th>
                  <th className="text-left text-[10.5px] tracking-[0.05em] uppercase text-[var(--faint)] font-bold px-[12px] py-[9px] border-b border-[var(--border)]">
                    Maps to
                  </th>
                </tr>
              </thead>
              <tbody>
                {event.fields.map((field) => (
                  <tr
                    key={field.name}
                    className="border-b border-[var(--border)] last:border-b-0"
                  >
                    <td className="px-[12px] py-[10px] text-[13px]">
                      <code className="font-[650] text-[var(--dyn)]">{field.name}</code>
                    </td>
                    <td className="px-[12px] py-[10px] text-[13px] text-[var(--muted)]">
                      {field.type}
                    </td>
                    <td className="px-[12px] py-[10px] text-[13px]">
                      {field.required ? (
                        <span className="text-[10.5px] font-bold text-[#b42318] bg-[#fee4e2] px-[7px] py-[1px] rounded-full">
                          required
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--faint)]">optional</span>
                      )}
                    </td>
                    <td className="px-[12px] py-[10px] text-[12px] text-[var(--green)] font-semibold">
                      → variable
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <span className="text-[var(--accent)] font-[650] cursor-pointer text-[13px] inline-block mt-[10px]">
            ＋ Add field
          </span>

          {/* Sample payload label */}
          <div className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold mt-4 mb-2">
            Sample payload (this is what your app sends us)
          </div>

          {/* Sample payload code block */}
          <pre
            className="bg-[var(--code,#0b1020)] text-[var(--codeink,#d7e0ff)] rounded-[10px] px-[15px] py-[13px] text-[12.5px] leading-[1.55] overflow-auto m-0 font-mono"
          >
            <span className="text-[var(--faint)]">{`POST /v1/events/${event.name}`}</span>
            {'\n{\n'}
            {sampleEntries.map(([key, val], i) => (
              <span key={key}>
                {'  '}
                <span style={{ color: '#7dd3fc' }}>&quot;{key}&quot;</span>
                {': '}
                <span style={{ color: val.startsWith('"') ? '#86efac' : '#fca5a5' }}>{val}</span>
                {i < sampleEntries.length - 1 ? ',' : ''}
                {'\n'}
              </span>
            ))}
            {'}'}
          </pre>
        </div>
      </div>
    </div>
  );
}
