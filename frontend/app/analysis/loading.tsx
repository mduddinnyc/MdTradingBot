export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-36 rounded-lg bg-gray-800 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-gray-800 animate-pulse" />
        ))}
      </div>
      <div className="h-72 rounded-xl bg-gray-800 animate-pulse" />
      <div className="h-48 rounded-xl bg-gray-800 animate-pulse" />
    </div>
  );
}
