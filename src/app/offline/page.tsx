export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-bold text-warn">Offline</h1>
      <p className="text-sm text-muted">Connection lost. Rejoin when back online.</p>
    </main>
  );
}
