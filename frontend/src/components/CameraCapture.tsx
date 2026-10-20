import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cámara propia (pantalla completa) pensada para fotos de equipos:
 *  - enfoque continuo y toque en pantalla para volver a enfocar,
 *  - foto de máxima resolución (ImageCapture.takePhoto cuando existe),
 *  - linterna para gabinetes oscuros.
 * Lo que enfoque realmente depende del teléfono; si no te sirve, hay un
 * botón para usar la cámara del propio teléfono.
 */

type FocusCaps = MediaTrackCapabilities & {
  focusMode?: string[];
  torch?: boolean;
};

interface Props {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Abre la cámara nativa del teléfono (plan B). */
  onNative: () => void;
}

export default function CameraCapture({ onCapture, onClose, onNative }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const capsRef = useRef<FocusCaps>({});

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no permite usar la cámara aquí (se necesita https).");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 4032 },
            height: { ideal: 3024 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;

        const caps = (track.getCapabilities?.() ?? {}) as FocusCaps;
        capsRef.current = caps;
        setHasTorch(!!caps.torch);

        // Enfoque continuo: la cámara sigue enfocando mientras apuntas.
        if (caps.focusMode?.includes("continuous")) {
          await track
            .applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] })
            .catch(() => undefined);
        }

        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
        setReady(true);
      } catch (e) {
        const name = (e as DOMException)?.name;
        setError(
          name === "NotAllowedError"
            ? "No diste permiso para usar la cámara. Actívalo en los permisos del navegador."
            : "No se pudo abrir la cámara."
        );
      }
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      /* el teléfono no la deja encender */
    }
  }

  /** Toque en pantalla: fuerza un nuevo enfoque y vuelve al continuo. */
  async function refocus(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setRing({ x, y });
    window.setTimeout(() => setRing(null), 900);

    const track = trackRef.current;
    const modes = capsRef.current.focusMode ?? [];
    if (!track) return;
    try {
      const point = { x: x / rect.width, y: y / rect.height };
      if (modes.includes("single-shot")) {
        await track.applyConstraints({
          advanced: [{ focusMode: "single-shot", pointsOfInterest: [point] } as MediaTrackConstraintSet],
        });
        window.setTimeout(() => {
          if (modes.includes("continuous")) {
            track
              .applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] })
              .catch(() => undefined);
          }
        }, 1200);
      }
    } catch {
      /* sin control de enfoque: la cámara sigue en automático */
    }
  }

  async function shoot() {
    const track = trackRef.current;
    const video = videoRef.current;
    if (!track || !video || busy) return;
    setBusy(true);

    try {
      // Pequeña pausa para que el enfoque se asiente tras pulsar.
      await new Promise((r) => window.setTimeout(r, 250));

      let blob: Blob | null = null;

      const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: (o?: object) => Promise<Blob>; getPhotoCapabilities?: () => Promise<{ imageWidth?: { max: number }; imageHeight?: { max: number } }> } }).ImageCapture;
      if (IC) {
        try {
          const ic = new IC(track);
          const pc = await ic.getPhotoCapabilities?.().catch(() => undefined);
          blob = await ic.takePhoto(
            pc?.imageWidth && pc?.imageHeight
              ? { imageWidth: pc.imageWidth.max, imageHeight: pc.imageHeight.max }
              : undefined
          );
        } catch {
          blob = null; // se usa el cuadro de video
        }
      }

      if (!blob) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")?.drawImage(video, 0, 0);
        blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.95));
      }

      if (blob) {
        stop();
        onCapture(new File([blob], `foto-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" }));
      } else {
        setError("No se pudo tomar la foto. Inténtalo otra vez.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label="Cámara">
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <button className="rounded-lg px-3 py-2 text-sm hover:bg-white/10" onClick={onClose}>✕ Cerrar</button>
        {hasTorch && (
          <button className="rounded-lg px-3 py-2 text-sm hover:bg-white/10" onClick={toggleTorch}>
            {torch ? "🔦 Linterna: sí" : "🔦 Linterna: no"}
          </button>
        )}
      </div>

      <div className="relative flex-1 overflow-hidden" onClick={refocus}>
        <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
        {ring && (
          <span
            className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-300"
            style={{ left: ring.x, top: ring.y }}
          />
        )}
        {!ready && !error && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Abriendo cámara...</p>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white">
            <p>{error}</p>
            <button className="btn-secondary" onClick={onNative}>Usar la cámara del teléfono</button>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 px-4 pb-6 pt-3">
        <p className="text-[11px] text-white/60">Toca la pantalla para enfocar. Mantén firme el teléfono al disparar.</p>
        <div className="flex w-full items-center justify-between">
          <button className="w-28 text-left text-xs text-white/70 underline" onClick={onNative}>Cámara del teléfono</button>
          <button
            aria-label="Tomar foto"
            disabled={!ready || busy}
            onClick={shoot}
            className="h-16 w-16 rounded-full border-4 border-white bg-white/90 active:scale-95 disabled:opacity-40"
          />
          <span className="w-28" />
        </div>
      </div>
    </div>
  );
}
