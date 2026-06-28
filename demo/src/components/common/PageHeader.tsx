import type React from 'react';

interface PageHeaderProps {
  title: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-[17px] font-[650] m-0">{title}</h1>
      {action && <div>{action}</div>}
    </div>
  );
}
