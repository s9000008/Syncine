import React from 'react';
import ReactDOM from 'react-dom/client';
import Popup from './Popup';
import { LanguageProvider } from '../locales';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <LanguageProvider>
      <Popup />
    </LanguageProvider>
  </React.StrictMode>
);
