import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { migrateBrowserStorage, migrateWalletConnectStorage } from '../shared/index.js';
import { App } from './app.js';

import '@fontsource/dm-mono/latin-400.css';
import './app.css';

migrateBrowserStorage();
void migrateWalletConnectStorage();

const container = document.getElementById('root');
if (!container) throw new Error('The page has no #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
