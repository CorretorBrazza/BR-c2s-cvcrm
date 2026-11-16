import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Layout } from './components/Layout';
import { useHashRoute } from './hooks/useHashRoute';
import { Dashboard } from './routes/Dashboard';
import { CvCrm } from './routes/CvCrm';
import { Diagnostics } from './routes/Diagnostics';
import { Inspection } from './routes/Inspection';
import { Leads } from './routes/Leads';
import { License } from './routes/License';
import { Logs } from './routes/Logs';
import { Metrics } from './routes/Metrics';
import { SettingsRoute } from './routes/Settings';
import { Templates } from './routes/Templates';
import { Windows } from './routes/Windows';
import { Notice } from './components/Ui';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[c2s] erro no painel', error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="p-6">
          <Notice tone="danger">
            O painel encontrou um erro: {this.state.error.message}. Recarregue a página; se persistir, abra o
            Diagnóstico.
          </Notice>
        </div>
      );
    }
    return this.props.children;
  }
}

function Router({ route }: { route: string }): JSX.Element {
  switch (route) {
    case 'leads':
      return <Leads />;
    case 'windows':
      return <Windows />;
    case 'cvcrm':
      return <CvCrm />;
    case 'logs':
      return <Logs />;
    case 'metrics':
      return <Metrics />;
    case 'templates':
      return <Templates />;
    case 'inspection':
      return <Inspection />;
    case 'settings':
      return <SettingsRoute />;
    case 'license':
      return <License />;
    case 'diagnostics':
      return <Diagnostics />;
    case 'dashboard':
    default:
      return <Dashboard />;
  }
}

export function App(): JSX.Element {
  const { route, navigate } = useHashRoute();
  return (
    <ErrorBoundary>
      <Layout route={route} navigate={navigate}>
        <Router route={route} />
      </Layout>
    </ErrorBoundary>
  );
}
