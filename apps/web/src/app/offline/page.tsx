export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-2xl font-bold">You are offline</h1>
      <p className="mt-3 text-ink-faint">
        This page has not been cached yet. Everything you have already opened
        still works — practice does not need a connection.
      </p>
    </div>
  );
}
