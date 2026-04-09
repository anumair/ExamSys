import { useState } from "react";
import { useNavigate } from "react-router-dom";

const bufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const generateStudentKeys = async () => {
  if (!window.crypto?.subtle) {
    throw new Error("WebCrypto is not available in this browser.");
  }
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const publicKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const publicKeyBase64 = bufferToBase64(publicKey);
  const privateKeyBase64 = bufferToBase64(privateKey);
  localStorage.setItem("student_private_key", privateKeyBase64);
  localStorage.setItem("student_public_key", publicKeyBase64);
  return publicKeyBase64;
};

function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);

  const [name, setName] = useState("");
  const [role, setRole] = useState("student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (endpoint) => {
    setStatus("Submitting...");
    setIsError(false);
    try {
      let publicKey = null;
      if (endpoint === "signup" && role === "student") {
        publicKey = await generateStudentKeys();
      }

      const response = await fetch(`/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          endpoint === "signup"
            ? { name, email, password, role, public_key: publicKey }
            : { email, password }
        ),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      localStorage.setItem("auth_token", data.token);
      localStorage.setItem("auth_role", data.role);
      if (data.role === "admin") {
        navigate("/admin");
      } else {
        navigate("/student");
      }
    } catch (error) {
      setStatus(error.message);
      setIsError(true);
    }
  };

  return (
    <div>
      <h1 className="page-title">Authentication</h1>
      <p className="page-subtitle">Sign up or log in to continue.</p>
      <div className="card">
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`tab ${tab === "login" ? "active" : ""}`}
            onClick={() => setTab("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={`tab ${tab === "signup" ? "active" : ""}`}
            onClick={() => setTab("signup")}
          >
            Signup
          </button>
        </div>

        {tab === "signup" && (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Full name"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="role">Role</label>
              <select
                id="role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #cbd5f5",
                  borderRadius: 10,
                  fontSize: 14,
                  background: "#fff",
                }}
                required
              >
                <option value="student">Student</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
        )}

        <div className="form-grid" style={{ marginTop: tab === "signup" ? 16 : 0 }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => submit(tab === "signup" ? "signup" : "login")}
          >
            {tab === "signup" ? "Create Account" : "Login"}
          </button>
        </div>

        {status && <div className={`status ${isError ? "error" : ""}`}>{status}</div>}
      </div>
    </div>
  );
}

export default AuthPage;
