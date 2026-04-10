import { useState } from "react";

function ResultAnnouncePage() {
  const [examId, setExamId] = useState("");
  const [correctAnswers, setCorrectAnswers] = useState(
    '{\n  "1": 2,\n  "2": 0,\n  "3": 1\n}'
  );
  const [status, setStatus] = useState("");
  const [isError, setIsError] = useState(false);
  const [results, setResults] = useState([]);

  const submit = async (event) => {
    event.preventDefault();
    setStatus("Announcing results...");
    setIsError(false);
    setResults([]);

    let parsedAnswers;
    try {
      parsedAnswers = JSON.parse(correctAnswers);
    } catch (error) {
      setStatus("Correct answers must be valid JSON.");
      setIsError(true);
      return;
    }

    const token = localStorage.getItem("auth_token");
    if (!token) {
      setStatus("Please log in as admin to announce results.");
      setIsError(true);
      return;
    }

    try {
      const response = await fetch("/api/admin/results/announce", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          exam_id: examId.trim(),
          correct_answers: parsedAnswers,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to announce results");
      }
      setResults(data.results || []);
      setStatus(
        `Results announced for ${data.exam_id}. Total questions: ${data.total_questions}.`
      );
    } catch (error) {
      setStatus(error.message || "Failed to announce results");
      setIsError(true);
    }
  };

  return (
    <div>
      <h1 className="page-title">Result Announce</h1>
      <p className="page-subtitle">
        Enter the exam ID and correct answers to calculate marks for each student.
      </p>
      <div className="card">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="resultExamId">Exam ID</label>
              <input
                id="resultExamId"
                type="text"
                value={examId}
                onChange={(event) => setExamId(event.target.value)}
                placeholder="CS101"
                required
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="correctAnswers">Correct Answers (JSON)</label>
            <textarea
              id="correctAnswers"
              value={correctAnswers}
              onChange={(event) => setCorrectAnswers(event.target.value)}
              rows={6}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #cbd5f5",
                borderRadius: 10,
                fontSize: 14,
              }}
            />
            <div className="helper">
              Example: {"{ \"1\": 2, \"2\": 0, \"3\": 1 }"}
            </div>
          </div>
          <div className="actions">
            <button type="submit" className="btn">
              Announce Results
            </button>
          </div>
        </form>
        {status && <div className={`status ${isError ? "error" : ""}`}>{status}</div>}
      </div>
      <div className="card">
        <div className="section-title">Results</div>
        {results.length === 0 && !isError && (
          <div className="helper">No results to display yet.</div>
        )}
        {results.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Exam ID</th>
                  <th>Score</th>
                  <th>Percentage</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {results.map((item) => (
                  <tr key={item.submission_id}>
                    <td>
                      {item.student_name || "Unknown"}
                      {item.student_email ? ` (${item.student_email})` : ""}
                    </td>
                    <td>{item.exam_id}</td>
                    <td>
                      {item.score} / {item.total}
                    </td>
                    <td>{item.percentage}%</td>
                    <td>
                      {item.submitted_at
                        ? new Date(item.submitted_at).toLocaleString()
                        : ""}
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

export default ResultAnnouncePage;
