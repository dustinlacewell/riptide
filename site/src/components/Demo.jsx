import { useState } from "react";
import App from "../../../src/App.jsx";
import { realClock } from "../../../src/clock.js";
import { createDemoSource } from "../../../src/demo/demoSource.js";
import { createDemoStore } from "../../../src/demo/prefs.js";
import { SourceProvider } from "../../../src/source/context.js";
import "../../../src/ui/ui.css";
import "../../../src/index.css";

/**
 * The real riptide app on a scripted demo source: nothing it does reaches
 * a disk or a server. The page mounts it client-only; Astro shows the
 * page's fallback figure until then.
 */
export default function Demo() {
  const [source] = useState(() => createDemoSource());
  const [storage] = useState(createDemoStore);
  return (
    <div className="rt-app demo-app">
      <SourceProvider source={source} storage={storage} clock={realClock}>
        <App />
      </SourceProvider>
    </div>
  );
}
