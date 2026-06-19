export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="text-muted-foreground">
        AeroQuote needs a connection for live data. Reconnect and try again.
      </p>
    </div>
  );
}
