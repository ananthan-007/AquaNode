"use client";

/**
 * ConnectModeProvider — wraps dashboard layout to install the hidden
 * Connect Mode activation listener and render the overlay when triggered.
 *
 * This component:
 *   1. Installs the 5× Space keypress listener on mount.
 *   2. Renders the ConnectModeOverlay when activated.
 *   3. Cleans up the listener on unmount.
 *
 * It adds NO visible UI to the normal layout.
 */

import { useCallback, useEffect, useState } from "react";
import { installConnectModeActivation } from "@/lib/connect-mode/activation";
import { ConnectModeOverlay } from "@/components/connect-mode/ConnectModeOverlay";

export function ConnectModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const handleActivate = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener("open-connect-mode", handleOpen);
    const activation = installConnectModeActivation(handleActivate);
    return () => {
      activation.destroy();
      window.removeEventListener("open-connect-mode", handleOpen);
    };
  }, [handleActivate]);

  return (
    <>
      {children}
      {isOpen && <ConnectModeOverlay onClose={handleClose} />}
    </>
  );
}
