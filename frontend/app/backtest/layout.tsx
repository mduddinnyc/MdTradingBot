import Navbar from "@/components/Navbar";

export default function BacktestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Navbar />
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
