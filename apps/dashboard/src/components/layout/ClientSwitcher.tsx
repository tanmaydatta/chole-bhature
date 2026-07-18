export function ClientSwitcher() {
  return (
    <div className="flex items-center gap-2 px-[10px] py-[5px] border border-[var(--border)] rounded-[8px] font-semibold cursor-pointer">
      <span className="w-5 h-5 rounded-[5px] bg-[#111827] text-white flex items-center justify-center text-[10px] font-bold">A</span>
      Acme Store ▾
    </div>
  );
}
