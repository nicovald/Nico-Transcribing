import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/baloo-2';
import './styles.css';

// Vercel Web Analytics only on the team site: the Vercel build (__TEAM__, so desktop and local
// builds don't even bundle it), outside Electron, on our own domain (not previews or localhost).
const analytics = __TEAM__ && !window.desktop && location.hostname.endsWith('.nicovald.dev');
const Analytics = analytics ? lazy(() => import('@vercel/analytics/react').then((m) => ({ default: m.Analytics }))) : null;

createRoot(document.getElementById('root')).render(
  <>
    <App />
    {Analytics && <Suspense fallback={null}><Analytics /></Suspense>}
  </>,
);
