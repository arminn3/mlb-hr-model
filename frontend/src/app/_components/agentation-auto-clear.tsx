"use client";

import { useState } from "react";
import { Agentation, saveAnnotations } from "agentation";

/** Wraps Agentation so messages auto-clear after you hit Copy.
 *  onCopy fires after the clipboard write; we wipe localStorage for the
 *  current pathname and bump the key to remount the toolbar fresh. */
export function AgentationAutoClear() {
  const [key, setKey] = useState(0);
  return (
    <Agentation
      key={key}
      onCopy={() => {
        if (typeof window !== "undefined") {
          saveAnnotations(window.location.pathname, []);
        }
        setKey((k) => k + 1);
      }}
    />
  );
}
