const NAV_ITEMS = [
  { key: "ga", label: "GA별 실적", href: "/dashboard" },
  { key: "insurer", label: "보험사별 실적", href: "/insurers" },
];

export default function TopNav({ currentPath, navigateTo }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-5">
        <button onClick={() => navigateTo("/dashboard")} className="shrink-0 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            GA ANALYSIS DASHBOARD
          </p>
        </button>
        <nav className="mt-6 flex items-end gap-0">
          {NAV_ITEMS.map((item) => {
            const isActive = currentPath === item.href;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigateTo(item.href)}
                className={`translate-y-[21px] border-b-2 px-4 pb-3 text-sm font-semibold transition ${
                  isActive
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-400 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
