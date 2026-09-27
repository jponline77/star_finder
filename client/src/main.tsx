import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fonts are bundled (offline friendly): Limelight = Broadway marquee display face,
// Nunito Variable = friendly, very readable body face.
import '@fontsource/limelight/400.css';
import '@fontsource-variable/nunito/wght.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/song.css';
import './styles/comments.css';
import './styles/layout.css';
import './styles/festival.css';

import { installChunkReload } from './lib/chunkReload';
import { initTheme } from './lib/theme';
import App from './App';

initTheme();

// A tab left open across a redeploy can't load the old build's page chunks — reload once.
installChunkReload();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
