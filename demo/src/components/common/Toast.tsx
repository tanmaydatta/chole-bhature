import { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react';
import type { ReactNode } from 'react';

interface ToastItem {
  id: number;
  message: string;
}

interface ToastContextValue {
  toast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const toast = useCallback((message: string) => {
    const id = ++nextId.current;
    setToasts(prev => [...prev, { id, message }]);
    const h = setTimeout(() => {
      timers.current.delete(id);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
    timers.current.set(id, h);
  }, []);

  // Clear any pending auto-dismiss timers on unmount to avoid firing
  // setToasts on an unmounted tree.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Fixed bottom-right toast container */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 9999,
          pointerEvents: 'none',
        }}
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            role="status"
            style={{
              background: 'var(--ink, #1e293b)',
              color: '#fff',
              borderRadius: '8px',
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: 600,
              boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              opacity: 1,
              transition: 'opacity 0.2s',
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
