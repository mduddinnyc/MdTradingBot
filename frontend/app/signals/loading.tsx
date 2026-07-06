export default function Loading() {
  return (
    <div className="flex min-h-screen">
      <div className="w-44 shrink-0" />
      <main className="flex-1 p-6 space-y-4">
        <div className="h-8 w-48 rounded-lg bg-gray-800 animate-pulse" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-800 animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-gray-800 animate-pulse" />
        <div className="h-48 rounded-xl bg-gray-800 animate-pulse" />
      </main>
    </div>
  );
}
