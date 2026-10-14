import { useEffect, useRef, useState } from "react";
import { wsUrl } from "../lib/api";
import type { SignalKey, TelemetryFrame } from "../types";

export const HISTORY_LENGTH = 150; // 30 s at 5 Hz
const HEARTBEAT_MS = 60_000;

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
    let heartbeat: number | undefined;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(wsUrl("/ws/telemetry"));
      ws.onopen = () => {
        retry.current = 0;
        setStatus("live");
        // Heartbeat: an open dashboard counts as activity on hosts that idle-sleep
        // (Render's free tier only counts inbound traffic).
        window.clearInterval(heartbeat);
        heartbeat = window.setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send("ping");
        }, HEARTBEAT_MS);
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
        window.clearInterval(heartbeat);
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
      window.clearInterval(heartbeat);
      // Closing a socket mid-handshake aborts it (browser warning + dev-proxy ECONNRESET),
      // which React StrictMode's mount→unmount→mount in dev does on every load.
      // Let it finish opening, then close it cleanly.
      const sock = ws;
      if (sock && sock.readyState === WebSocket.CONNECTING) {
        sock.onopen = () => sock.close();
        sock.onmessage = null;
        sock.onclose = null;
        sock.onerror = null;
      } else {
        sock?.close();
      }
    };
  }, []);

  return { frame, history, status };
}
