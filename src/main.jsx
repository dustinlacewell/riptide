import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/tokens.css'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './ui/ui.css'
import './index.css'
import './page.css'
import App from './App.jsx'
import { realClock } from './clock.js'
import { SourceProvider } from './source/context.js'
import * as httpSource from './source/httpSource.js'
import { localStore } from './storage.js'

// #root carries the rt-app class (index.html) that scopes the app's CSS.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SourceProvider source={httpSource} storage={localStore} clock={realClock}>
      <App />
    </SourceProvider>
  </StrictMode>,
)
