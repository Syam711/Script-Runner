import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProtectedRoute from './ProtectedRoute';

export default function AdminRoute({ children }) {
  const { isAdmin, status } = useAuth();

  return (
    <ProtectedRoute>
      {status === 'ready' && !isAdmin ? <Navigate to="/" replace /> : children}
    </ProtectedRoute>
  );
}
