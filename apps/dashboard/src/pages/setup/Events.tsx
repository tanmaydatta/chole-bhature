import { useState } from 'react';
import { useEventsStore } from '../../data/eventsStore';
import { PageHeader } from '../../components/common/PageHeader';
import type { EventField } from '../../lib/types';

export default function Events() {
  const events = useEventsStore(s => s.events);
  const addEvent = useEventsStore(s => s.addEvent);
  const updateEvent = useEventsStore(s => s.updateEvent);

  // Track selection by name so it survives list changes
  const [selectedName, setSelectedName] = useState<string>(events[0]?.name ?? '');
  const [editing, setEditing] = useState(false);

  // Draft state for editing
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftFields, setDraftFields] = useState<EventField[]>([]);
  const [draftSample, setDraftSample] = useState<Record<string, string>>({});

  const selectedIdx = events.findIndex(e => e.name === selectedName);
  const event = events[selectedIdx >= 0 ? selectedIdx : 0];

  const sampleEntries = Object.entries(event.sample);

  function enterEditMode(ev: typeof event) {
    setDraftName(ev.name);
    setDraftDesc(ev.description);
    setDraftFields(ev.fields.map(f => ({ ...f })));
    setDraftSample({ ...ev.sample });
    setEditing(true);
  }

  function handleSave() {
    const originalName = event.name;
    const patch = {
      name: draftName,
      description: draftDesc,
      fields: draftFields,
      sample: draftSample,
    };
    updateEvent(originalName, patch);
    // Update selection to new name
    setSelectedName(draftName);
    setEditing(false);
  }

  function handleNewEvent() {
    const newEv = {
      name: 'new_event',
      description: '',
      live: false,
      usedIn: 0,
      fields: [],
      sample: {},
    };
    addEvent(newEv);
    setSelectedName(newEv.name);
    enterEditMode(newEv);
  }

  function handleSelectEvent(name: string) {
    setSelectedName(name);
    setEditing(false);
  }

  function updateField(idx: number, patch: Partial<EventField>) {
    setDraftFields(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  }

  function removeField(idx: number) {
    setDraftFields(prev => prev.filter((_, i) => i !== idx));
  }

  function addField() {
    setDraftFields(prev => [...prev, { name: '', type: 'string', required: false }]);
  }

  return (
    <div>
      <div className="mb-4">
        <PageHeader
          title="Events"
          action={
            <button
              onClick={handleNewEvent}
              className="border-none px-[14px] py-[8px] rounded-[8px] font-semibold text-[13px] cursor-pointer bg-[var(--accent)] text-white"
            >
              ＋ New event
            </button>
          }
        />
      </div>

      <div className="flex gap-5 items-start">
        {/* Left: event list */}
        <div className="w-[260px] flex-shrink-0 flex flex-col gap-2">
          {events.map((ev) => (
            <div
              key={ev.name}
              onClick={() => handleSelectEvent(ev.name)}
              className={`bg-[var(--panel)] border rounded-[11px] px-[13px] py-[12px] cursor-pointer shadow-[var(--shadow)] ${
                ev.name === selectedName
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
          {editing ? (
            /* ── EDIT MODE ── */
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-3 gap-3">
                <div className="flex-1 min-w-0">
                  <label htmlFor="event-name" className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold block mb-1">
                    Event name
                  </label>
                  <input
                    id="event-name"
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    className="w-full border border-[var(--border)] rounded-[7px] px-[10px] py-[6px] text-[15px] font-mono bg-[var(--panel)] text-[var(--ink)]"
                  />
                </div>
                <button
                  onClick={handleSave}
                  className="border-none px-[14px] py-[8px] rounded-[8px] font-semibold text-[13px] cursor-pointer bg-[var(--accent)] text-white flex-shrink-0"
                >
                  Save
                </button>
              </div>

              {/* Description */}
              <div className="mb-4">
                <label htmlFor="event-description" className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold block mb-1">
                  Description
                </label>
                <input
                  id="event-description"
                  value={draftDesc}
                  onChange={e => setDraftDesc(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-[7px] px-[10px] py-[6px] text-[13px] bg-[var(--panel)] text-[var(--ink)]"
                />
              </div>

              {/* Payload schema section label */}
              <div className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold mt-4 mb-2">
                Payload schema — each field becomes a variable
              </div>

              {/* Editable fields table */}
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
                        Remove
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftFields.map((field, idx) => (
                      <tr key={idx} className="border-b border-[var(--border)] last:border-b-0">
                        <td className="px-[12px] py-[8px]">
                          <input
                            aria-label={`field name ${idx}`}
                            value={field.name}
                            onChange={e => updateField(idx, { name: e.target.value })}
                            className="border border-[var(--border)] rounded-[5px] px-[7px] py-[3px] text-[12.5px] font-mono bg-[var(--panel)] text-[var(--ink)] w-full"
                          />
                        </td>
                        <td className="px-[12px] py-[8px]">
                          <select
                            aria-label={`field type ${idx}`}
                            value={field.type}
                            onChange={e => updateField(idx, { type: e.target.value as EventField['type'] })}
                            className="border border-[var(--border)] rounded-[5px] px-[7px] py-[3px] text-[12.5px] bg-[var(--panel)] text-[var(--ink)]"
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="enum">enum</option>
                            <option value="date">date</option>
                          </select>
                        </td>
                        <td className="px-[12px] py-[8px]">
                          <input
                            type="checkbox"
                            aria-label={`field required ${idx}`}
                            checked={field.required}
                            onChange={e => updateField(idx, { required: e.target.checked })}
                          />
                        </td>
                        <td className="px-[12px] py-[8px]">
                          <button
                            onClick={() => removeField(idx)}
                            aria-label={`remove field ${idx}`}
                            className="text-[var(--faint)] hover:text-red-500 text-[13px] border-none bg-transparent cursor-pointer"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <span
                onClick={addField}
                className="text-[var(--accent)] font-[650] cursor-pointer text-[13px] inline-block mt-[10px]"
              >
                ＋ Add field
              </span>

              {/* Sample payload label */}
              <div className="text-[11px] uppercase tracking-[0.05em] text-[var(--faint)] font-bold mt-4 mb-2">
                Sample payload (this is what your app sends us)
              </div>

              {/* Editable sample textarea */}
              <textarea
                aria-label="sample payload"
                value={JSON.stringify(draftSample, null, 2)}
                onChange={e => {
                  try {
                    setDraftSample(JSON.parse(e.target.value) as Record<string, string>);
                  } catch {
                    // ignore parse errors while typing
                  }
                }}
                rows={Object.keys(draftSample).length + 2}
                className="w-full border border-[var(--border)] rounded-[10px] px-[15px] py-[13px] text-[12.5px] font-mono bg-[var(--code,#0b1020)] text-[var(--codeink,#d7e0ff)] resize-y"
              />
            </>
          ) : (
            /* ── READ MODE ── */
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-1">
                <h2 className="m-0 text-[18px] font-mono">{event.name}</h2>
                <button
                  onClick={() => enterEditMode(event)}
                  className="border-none px-[12px] py-[6px] rounded-[8px] font-semibold text-[13px] cursor-pointer bg-[var(--hover)] text-[var(--ink)]"
                >
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
                            <span className="text-[10.5px] font-bold px-[7px] py-[1px] rounded-full" style={{ color: 'var(--req)', background: 'var(--req-bg)' }}>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
