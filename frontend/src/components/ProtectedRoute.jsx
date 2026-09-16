import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileBlockedScreen from './MobileBlockedScreen';
import AppShell from './AppShell';

export default function ProtectedRoute({ children }) {
  const { session, status } = useAuth();
  const isMobile = useIsMobile();

  if (status === 'loading') {
    return (
      <div className="boot">
        <span className="boot-bar" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (isMobile) return <MobileBlockedScreen />;

  return <AppShell>{children}</AppShell>;
}
