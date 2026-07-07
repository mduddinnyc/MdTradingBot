export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-48 rounded-lg bg-gray-800 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-40 rounded-xl bg-gray-800 animate-pulse" />
        ))}
      </div>
      <div className="h-32 rounded-xl bg-gray-800 animate-pulse" />
    </div>
  );
}
