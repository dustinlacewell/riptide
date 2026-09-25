import { useState, useSyncExternalStore } from "react";
import App from "../../../src/App.jsx";
import { realClock } from "../../../src/clock.js";
import { createDemoSource } from "../../../src/demo/demoSource.js";
import { createDemoStore } from "../../../src/demo/prefs.js";
import { SourceProvider } from "../../../src/source/context.js";
import "../../../src/ui/ui.css";
import "../../../src/index.css";

/**
 * The real riptide app on a scripted demo source: nothing it does reaches
 * a disk or a server. Until it has mounted it shows its children — the
 * static telemetry figure the page passes in — so the server-rendered
 * page and the first paint carry no app markup.
 */
export default function Demo({ children }) {
  const [source] = useState(() => createDemoSource());
  const [storage] = useState(createDemoStore);
  // False while hydrating the server's markup, true on the render after.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  if (!hydrated) return children;
  return (
    <div className="rt-app demo-app">
      <SourceProvider source={source} storage={storage} clock={realClock}>
        <App />
      </SourceProvider>
    </div>
  );
}

const subscribeNever = () => () => {};
