import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";

const DISMISSED_KEY = "menorca.pwaInstallPrompt.dismissed";

function isRunningStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isMobileDevice() {
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === "1",
  );
  const [installed, setInstalled] = useState(isRunningStandalone());

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      localStorage.removeItem(DISMISSED_KEY);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const showPrompt = useMemo(() => {
    return Boolean(deferredPrompt) && isMobileDevice() && !dismissed && !installed;
  }, [deferredPrompt, dismissed, installed]);

  async function onInstallClick() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  function onDismissClick() {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, "1");
  }

  if (!showPrompt) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[70] w-[calc(100%-1rem)] max-w-[432px]"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
    >
      <div className="app-card p-3 flex items-center gap-3 shadow-md">
        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          <Download className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground leading-tight">Install this app</p>
          <p className="text-xs text-muted-foreground">Add it to your home screen for faster access.</p>
        </div>
        <button
          onClick={onInstallClick}
          className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold"
        >
          Install
        </button>
        <button
          onClick={onDismissClick}
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

