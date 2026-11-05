import { useEffect, useState } from "react";

type HealthState = "checking" | "ok" | "unreachable";

export function App() {
  const [health, setHealth] = useState<HealthState>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((response) => setHealth(response.ok ? "ok" : "unreachable"))
      .catch(() => setHealth("unreachable"));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <img src="/favicon.svg" alt="" width={32} height={32} />
        <h1>Intake</h1>
      </header>
      <main className="app-main">
        <p className="muted">Scaffold ready. Server status: {health}.</p>
      </main>
    </div>
  );
}
