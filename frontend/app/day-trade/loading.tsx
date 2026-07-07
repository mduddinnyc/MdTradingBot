export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-48 rounded-lg bg-gray-800 animate-pulse" />
      <div className="h-4 w-full max-w-lg rounded bg-gray-800 animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-72 rounded-xl bg-gray-800 animate-pulse" />
        <div className="h-72 rounded-xl bg-gray-800 animate-pulse" />
      </div>
    </div>
  );
}
