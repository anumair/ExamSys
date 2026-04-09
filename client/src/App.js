import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import AdminPage from "./pages/AdminPage";
import StudentPage from "./pages/StudentPage";

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <div className="page">
          <nav className="nav">
            <Link className="nav-link" to="/admin">
              Admin
            </Link>
            <Link className="nav-link" to="/student">
              Student
            </Link>
          </nav>

          <Routes>
            <Route path="/" element={<Navigate to="/admin" replace />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/student" element={<StudentPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
