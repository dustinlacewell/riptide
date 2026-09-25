import { useState } from "react";
import App from "../../../src/App.jsx";
import { realClock } from "../../../src/clock.js";
import { createDemoSource } from "../../../src/demo/demoSource.js";
import { createDemoStore } from "../../../src/demo/prefs.js";
import { SourceProvider } from "../../../src/source/context.js";
import { cls } from "../../../src/ui/cls.js";
import { useSize } from "../../../src/ui/useSize.js";
import "../../../src/ui/ui.css";
import "../../../src/index.css";

/** The app window's design size, in CSS px. Each tab's first screen fits it. */
const WIDTH = 1200;
const HEIGHT = 840;

/**
 * The real riptide app on a scripted demo source: nothing it does reaches
 * a disk or a server. The page mounts it client-only; Astro shows the
 * page's fallback figure until then.
 *
 * The app renders at a fixed size, like a window. Where the page is
 * narrower than that, the whole window scales down, and the box around it
 * takes the scaled height so the page below does not jump.
 */
export default function Demo() {
  const [source] = useState(() => createDemoSource());
  const [storage] = useState(createDemoStore);
  const [fit, { width }] = useSize();
  const scale = width > 0 ? Math.min(1, width / WIDTH) : 1;

  return (
    <div ref={fit} style={{ height: HEIGHT * scale }}>
      <div
        className={cls("rt-app", "demo-app", source.caps.window && "is-window")}
        style={{
          width: WIDTH,
          height: HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <SourceProvider source={source} storage={storage} clock={realClock}>
          <App />
        </SourceProvider>
      </div>
    </div>
  );
}
