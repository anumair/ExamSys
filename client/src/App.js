import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import AdminPage from "./pages/AdminPage";
import AuthPage from "./pages/AuthPage";
import LogsPage from "./pages/LogsPage";
import ResultAnnouncePage from "./pages/ResultAnnouncePage";
import StudentPage from "./pages/StudentPage";

const isAuthed = () => {
  const token = localStorage.getItem("auth_token");
  return Boolean(token);
};

const hasRole = (role) => {
  const storedRole = localStorage.getItem("auth_role");
  return storedRole === role;
};

const ProtectedRoute = ({ children, role }) => {
  if (!isAuthed()) {
    return <Navigate to="/auth" replace />;
  }
  if (role && !hasRole(role)) {
    return <Navigate to="/auth" replace />;
  }
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <div className="page">
          <nav className="nav">
            <Link className="nav-link" to="/auth">
              Auth
            </Link>
            <Link className="nav-link" to="/admin">
              Admin
            </Link>
            <Link className="nav-link" to="/admin/logs">
              Logs
            </Link>
            <Link className="nav-link" to="/admin/results">
              Results
            </Link>
            <Link className="nav-link" to="/student">
              Student
            </Link>
          </nav>

          <Routes>
            <Route path="/" element={<Navigate to="/auth" replace />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute role="admin">
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/logs"
              element={
                <ProtectedRoute role="admin">
                  <LogsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/results"
              element={
                <ProtectedRoute role="admin">
                  <ResultAnnouncePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/student"
              element={
                <ProtectedRoute role="student">
                  <StudentPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
