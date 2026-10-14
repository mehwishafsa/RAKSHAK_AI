import { useEffect, useRef, useState } from "react";
import { wsUrl } from "../lib/api";
import type { SignalKey, TelemetryFrame } from "../types";

export const HISTORY_LENGTH = 150; // 30 s at 5 Hz

export interface HistoryPoint {
  t: number;
  values: Record<SignalKey, number>;
  risk: TelemetryFrame["detection"]["risk"];
}

export type ConnectionStatus = "connecting" | "live" | "reconnecting";

/** Subscribes to /ws/telemetry with auto-reconnect and keeps a rolling history buffer. */
export function useTelemetry() {
  const [frame, setFrame] = useState<TelemetryFrame | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const retry = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(wsUrl("/ws/telemetry"));
      ws.onopen = () => {
        retry.current = 0;
        setStatus("live");
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as TelemetryFrame;
        if (msg.type !== "telemetry") return;
        setFrame(msg);
        const r = msg.readings;
        setHistory((h) => {
          const next = h.length >= HISTORY_LENGTH ? h.slice(h.length - HISTORY_LENGTH + 1) : h.slice();
          next.push({
            t: msg.sim_time,
            values: {
              vibration_rms: r.vibration_rms,
              kurtosis: r.kurtosis,
              temperature: r.temperature,
              pressure: r.pressure,
              oil_quality: r.oil_quality,
            },
            risk: msg.detection.risk,
          });
          return next;
        });
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus("reconnecting");
        const delay = Math.min(5000, 400 * 2 ** retry.current++);
        timer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { frame, history, status };
}
