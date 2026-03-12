import { useEffect, useMemo, useState } from "react";

interface PhaseTimerProps {
  deadlineAt: number | null;
}

export function PhaseTimer({ deadlineAt }: PhaseTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const remainingSeconds = useMemo(() => {
    if (!deadlineAt) {
      return null;
    }

    return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  }, [deadlineAt, now]);

  if (remainingSeconds === null) {
    return <span className="timer timer--static">Waiting on host</span>;
  }

  return (
    <span className={`timer ${remainingSeconds <= 5 ? "timer--urgent" : ""}`}>
      {remainingSeconds}s left
    </span>
  );
}
