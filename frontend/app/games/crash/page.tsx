import { CrashGameClient } from "./crash-game-client";

export default function CrashPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Crash</h1>
      </div>
      <CrashGameClient />
    </div>
  );
}
