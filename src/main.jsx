import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

console.log('[MAIN] app mounted');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .then((results) => {
      if (results.some(Boolean)) console.log('[MAIN] Existing service workers unregistered');
    })
    .catch((error) => console.warn('[MAIN] Service worker cleanup failed', error));
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
