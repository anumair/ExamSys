import { useEffect, useState } from "react";

function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("");

  const loadLogs = async () => {
    setStatus("Loading logs...");
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setStatus("Please log in as admin to view logs.");
      return;
    }
    try {
      const response = await fetch("/api/admin/logs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to load logs");
      }
      setLogs(data);
      setStatus("");
    } catch (error) {
      setStatus(error.message);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  return (
    <div>
      <h1 className="page-title">Action Logs</h1>
      <p className="page-subtitle">System-wide activity for admin review.</p>
      <div className="card">
        {status && <div className="status error">{status}</div>}
        {logs.length === 0 && !status && <div className="helper">No logs yet.</div>}
        {logs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Role</th>
                  <th>Exam ID</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((item) => (
                  <tr key={item._id}>
                    <td>{new Date(item.created_at).toLocaleString()}</td>
                    <td>{item.action}</td>
                    <td>
                      {item.actor_name || "System"}
                      {item.actor_email ? ` (${item.actor_email})` : ""}
                    </td>
                    <td>{item.actor_role || "system"}</td>
                    <td>{item.exam_id || "-"}</td>
                    <td>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {item.metadata ? JSON.stringify(item.metadata, null, 2) : "-"}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default LogsPage;
