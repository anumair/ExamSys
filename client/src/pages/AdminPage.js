import { useState } from "react";

function AdminPage() {
  const [examId, setExamId] = useState("");
  const [examTime, setExamTime] = useState("");
  const [file, setFile] = useState(null);
  const [adminStatus, setAdminStatus] = useState("");
  const [adminError, setAdminError] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setAdminStatus("Submitting...");
    setAdminError(false);

    const formData = new FormData();
    formData.append("exam_id", examId);
    formData.append("exam_time", examTime);
    if (file) {
      formData.append("file", file);
    }

    try {
      const response = await fetch("/api/admin/exams", {
        method: "POST",
        body: formData,
      });

      const rawText = await response.text();
      let data = null;
      if (rawText) {
        data = JSON.parse(rawText);
      }

      if (!response.ok) {
        throw new Error(data?.error || rawText || "Upload failed");
      }

      setAdminStatus(`Created exam ${data?.exam_id || ""} successfully.`);
      setAdminError(false);
      setExamId("");
      setExamTime("");
      setFile(null);
    } catch (error) {
      setAdminStatus(error.message);
      setAdminError(true);
    }
  };

  return (
    <div>
      <h1 className="page-title">Admin Module</h1>
      <p className="page-subtitle">
        Upload the exam paper and generate the secure package for students.
      </p>
      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="examId">Exam ID</label>
              <input
                id="examId"
                type="text"
                value={examId}
                onChange={(event) => setExamId(event.target.value)}
                placeholder="CS101"
                required
              />
              <div className="helper">Unique code used by students.</div>
            </div>
            <div className="field">
              <label htmlFor="examTime">Exam Time (UTC)</label>
              <input
                id="examTime"
                type="datetime-local"
                value={examTime}
                onChange={(event) => setExamTime(event.target.value)}
                required
              />
              <div className="helper">Use the official exam start time.</div>
            </div>
          </div>
          <div className="divider" />
          <div className="field">
            <label htmlFor="paperFile">Upload Paper (PDF or Text)</label>
            <input
              id="paperFile"
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              required
            />
            <div className="helper">PDF preferred for final exams.</div>
          </div>
          <div className="actions">
            <button type="submit" className="btn">
              Create Exam Package
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setExamId("");
                setExamTime("");
                setFile(null);
                setAdminStatus("");
                setAdminError(false);
              }}
            >
              Reset
            </button>
          </div>
        </form>
        {adminStatus && (
          <div className={`status ${adminError ? "error" : ""}`}>
            {adminStatus}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminPage;
