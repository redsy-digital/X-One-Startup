import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

// Root-level ErrorBoundary — impede que qualquer crash apague o ecrã inteiro
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackLabel="Erro crítico da aplicação">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
