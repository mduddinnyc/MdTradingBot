export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-32 rounded-lg bg-gray-800 animate-pulse" />
      <div className="h-14 rounded-xl bg-gray-800 animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="h-80 rounded-xl bg-gray-800 animate-pulse" />
        <div className="h-80 rounded-xl bg-gray-800 animate-pulse lg:col-span-2" />
      </div>
    </div>
  );
}
