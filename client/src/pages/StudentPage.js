import { useEffect, useMemo, useState } from "react";

const EPOCH_TIME = process.env.REACT_APP_EPOCH_TIME || "2025-01-01T00:00:00Z";
const STEP_SIZE_SECONDS = Number(process.env.REACT_APP_STEP_SIZE_SECONDS || "300");

const base64ToBytes = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const bytesToBase64 = (value) => {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const hexToBytes = (value) => {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(value.substr(i * 2, 2), 16);
  }
  return bytes;
};

const pemToArrayBuffer = (pem) => {
  const cleaned = pem.replace(
    /-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g,
    ""
  );
  return base64ToBytes(cleaned).buffer;
};

const sha256 = async (data) => {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
};

const deriveKnFromK1 = async (k1Bytes, n) => {
  let current = new Uint8Array(k1Bytes);
  for (let i = 1; i < n; i += 1) {
    current = await sha256(current);
  }
  return current;
};

const deriveEncKey = async (knBytes) => {
  const hkdfKey = await crypto.subtle.importKey("raw", knBytes, "HKDF", false, [
    "deriveBits",
  ]);
  const encBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array([]),
      info: new TextEncoder().encode("exam-encryption"),
    },
    hkdfKey,
    256
  );
  return crypto.subtle.importKey("raw", encBits, "AES-GCM", false, ["decrypt"]);
};

const parseQuestions = (text) => {
  const blocks = [];
  const regex = /(?:^|\n)\s*(\d+)\.\s*([\s\S]*?)(?=(?:\n\s*\d+\.|$))/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const id = Number(match[1]);
    const body = match[2].replace(/\s+/g, " ").trim();
    const parts = body.split(/\s*[A-D]\)\s*/).filter(Boolean);
    if (parts.length < 2) {
      continue;
    }
    const question = parts[0].trim();
    const options = parts.slice(1).map((option) => option.trim());
    if (!question || options.length < 2) {
      continue;
    }
    blocks.push({ id, question, options });
  }
  return blocks;
};

const formatTime = (value) => {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const normalizeAnswers = (value) => {
  const sortedKeys = Object.keys(value).sort((a, b) => Number(a) - Number(b));
  const normalized = {};
  sortedKeys.forEach((key) => {
    normalized[key] = value[key];
  });
  return normalized;
};

const canonicalizePayload = (payload) => {
  if (!payload) {
    return null;
  }
  const normalizedAnswers = normalizeAnswers(payload.answers || {});
  if (!payload.exam_id || !payload.student_id || !payload.timestamp) {
    return null;
  }
  const canonical = {
    exam_id: payload.exam_id,
    student_id: payload.student_id,
    answers: normalizedAnswers,
    timestamp: payload.timestamp,
  };
  return { canonical, message: JSON.stringify(canonical) };
};

function StudentPage() {
  const [studentExamId, setStudentExamId] = useState("");
  const [studentStatus, setStudentStatus] = useState("");
  const [studentError, setStudentError] = useState(false);
  const [paperText, setPaperText] = useState("");
  const [paperUrl, setPaperUrl] = useState("");
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeLeft, setTimeLeft] = useState(60);
  const [globalTimeLeft, setGlobalTimeLeft] = useState(0);
  const [quizActive, setQuizActive] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
  const [examIdForQuiz, setExamIdForQuiz] = useState("");
  const [submissionStatus, setSubmissionStatus] = useState("");
  const [submissionError, setSubmissionError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const epochMs = useMemo(() => new Date(EPOCH_TIME).getTime(), []);

  const advanceQuestion = () => {
    setCurrentIndex((index) => {
      const next = index + 1;
      if (next >= questions.length) {
        setQuizActive(false);
        setQuizFinished(true);
        return index;
      }
      return next;
    });
  };

  useEffect(() => {
    if (!quizActive) {
      return undefined;
    }
    if (globalTimeLeft <= 0) {
      setQuizActive(false);
      setQuizFinished(true);
      return undefined;
    }
    const timer = setTimeout(() => {
      setGlobalTimeLeft((value) => Math.max(0, value - 1));
      setTimeLeft((value) => {
        if (value <= 1) {
          advanceQuestion();
          return 60;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [quizActive, timeLeft, globalTimeLeft, questions.length]);

  const handlePackageProcess = async (event) => {
    event.preventDefault();
    setStudentStatus("");
    setStudentError(false);
    setPaperText("");
    setPaperUrl("");
    setQuestions([]);
    setAnswers({});
    setQuizActive(false);
    setQuizFinished(false);
    setExamIdForQuiz("");
    setSubmissionStatus("");
    setSubmissionError(false);
    setSubmitting(false);

    if (!studentExamId.trim()) {
      setStudentStatus("Please enter Exam ID.");
      setStudentError(true);
      return;
    }

    if (!window.crypto?.subtle) {
      setStudentStatus("WebCrypto is not available in this browser.");
      setStudentError(true);
      return;
    }

    try {
      const response = await fetch(
        `/api/student/packages/${encodeURIComponent(studentExamId.trim())}`
      );
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || "Package not found");
      }
      const parsed = JSON.parse(rawText);

      const {
        exam_id,
        exam_time,
        k1,
        ciphertext,
        nonce,
        tag,
        aad,
        signature,
        public_key,
        version,
        content_type,
      } = parsed;

      const payload = {
        exam_id,
        exam_time,
        k1,
        ciphertext,
        nonce,
        tag,
        aad,
        version,
        ...(content_type ? { content_type } : {}),
      };

      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      const signatureBytes = base64ToBytes(signature);
      const publicKeyBytes = pemToArrayBuffer(public_key);

      const publicKey = await crypto.subtle.importKey(
        "spki",
        publicKeyBytes,
        { name: "Ed25519" },
        false,
        ["verify"]
      );

      const verified = await crypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        signatureBytes,
        payloadBytes
      );

      if (!verified) {
        setStudentStatus("Signature verification failed. Package may be tampered.");
        setStudentError(true);
        return;
      }

      const now = Date.now();
      const examTimeMs = new Date(exam_time).getTime();
      if (now < examTimeMs) {
        setStudentStatus("Waiting for exam time...");
        return;
      }

      const stepMs = STEP_SIZE_SECONDS * 1000;
      const n = Math.floor((now - epochMs) / stepMs);
      if (n < 1) {
        setStudentStatus("Access denied or invalid time.");
        setStudentError(true);
        return;
      }

      const k1Bytes = hexToBytes(k1);
      const knBytes = await deriveKnFromK1(k1Bytes, n);
      const encKey = await deriveEncKey(knBytes);

      const cipherBytes = base64ToBytes(ciphertext);
      const nonceBytes = base64ToBytes(nonce);
      const tagBytes = base64ToBytes(tag);
      const aadBytes = base64ToBytes(aad);

      const combinedCipher = new Uint8Array(cipherBytes.length + tagBytes.length);
      combinedCipher.set(cipherBytes);
      combinedCipher.set(tagBytes, cipherBytes.length);

      const plainBuffer = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonceBytes,
          additionalData: aadBytes,
        },
        encKey,
        combinedCipher
      );

      const plainBytes = new Uint8Array(plainBuffer);
      const isPdf =
        plainBytes.length >= 4 &&
        plainBytes[0] === 0x25 &&
        plainBytes[1] === 0x50 &&
        plainBytes[2] === 0x44 &&
        plainBytes[3] === 0x46;

      if (content_type === "text") {
        const text = new TextDecoder().decode(plainBytes);
        const parsedQuestions = parseQuestions(text);
        if (parsedQuestions.length === 0) {
          setStudentStatus("No questions found in the decrypted text.");
          setStudentError(true);
          return;
        }
        setQuestions(parsedQuestions);
        setCurrentIndex(0);
        setTimeLeft(60);
        setGlobalTimeLeft(parsedQuestions.length * 60);
        setQuizActive(true);
        setQuizFinished(false);
        setExamIdForQuiz(exam_id);
        setStudentStatus("Quiz started.");
      } else if (isPdf) {
        const blob = new Blob([plainBytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setPaperUrl(url);
        setStudentStatus("Decryption successful. PDF ready.");
      } else {
        const text = new TextDecoder().decode(plainBytes);
        setPaperText(text);
        setStudentStatus("Decryption successful.");
      }

      fetch("/api/student/decrypt-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exam_id, exam_time }),
      }).catch(() => {});
    } catch (error) {
      setStudentStatus(error.message || "Access denied or invalid time.");
      setStudentError(true);
    }
  };

  const handleSubmitAnswers = async () => {
    setSubmissionStatus("");
    setSubmissionError(false);

    if (!examIdForQuiz) {
      setSubmissionStatus("Exam ID missing for submission.");
      setSubmissionError(true);
      return;
    }

    const token = localStorage.getItem("auth_token");
    if (!token) {
      setSubmissionStatus("Please log in again to submit answers.");
      setSubmissionError(true);
      return;
    }

    const studentId = localStorage.getItem("auth_user_id");
    if (!studentId) {
      setSubmissionStatus("Student ID missing. Please log in again.");
      setSubmissionError(true);
      return;
    }

    const privateKeyBase64 = localStorage.getItem("student_private_key");
    if (!privateKeyBase64) {
      setSubmissionStatus("Private key not found in this browser.");
      setSubmissionError(true);
      return;
    }

    try {
      setSubmitting(true);
      const normalizedAnswers = normalizeAnswers(answers);
      const payload = {
        exam_id: examIdForQuiz,
        student_id: studentId,
        answers: normalizedAnswers,
        timestamp: new Date().toISOString(),
      };
      const canonicalized = canonicalizePayload(payload);
      if (!canonicalized) {
        throw new Error("Invalid submission payload.");
      }
      const message = canonicalized.message;
      const keyBytes = base64ToBytes(privateKeyBase64);
      const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        keyBytes.buffer,
        { name: "Ed25519" },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign(
        { name: "Ed25519" },
        privateKey,
        new TextEncoder().encode(message)
      );
      const signatureBase64 = bytesToBase64(new Uint8Array(signature));

      const response = await fetch("/api/student/submit-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          payload: canonicalized.canonical,
          signature: signatureBase64,
        }),
      });
      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responsePayload.error || "Submission failed");
      }
      setSubmissionStatus("Answers submitted and verified.");
      setSubmissionError(false);
    } catch (error) {
      setSubmissionStatus(error.message || "Submission failed.");
      setSubmissionError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">Student Module</h1>
      <p className="page-subtitle">
        Fetch package by exam ID, verify signature, decrypt, and display the paper.
      </p>
      <div className="card">
        <form onSubmit={handlePackageProcess}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="studentExamId">Exam ID</label>
              <input
                id="studentExamId"
                type="text"
                value={studentExamId}
                onChange={(event) => setStudentExamId(event.target.value)}
                placeholder="CS101"
                required
              />
              <div className="helper">Enter the exam code provided to you.</div>
            </div>
          </div>
          <div className="actions">
            <button type="submit" className="btn">
              Fetch & Decrypt
            </button>
          </div>
        </form>
        {studentStatus && (
          <div className={`status ${studentError ? "error" : ""}`}>
            {studentStatus}
          </div>
        )}
      </div>

      {paperUrl && (
        <div className="card" style={{ marginTop: 16 }}>
          <iframe
            title="Exam PDF"
            src={paperUrl}
            style={{ width: "100%", height: 600, border: "1px solid #e2e8f0" }}
          />
        </div>
      )}
      {paperText && !quizActive && (
        <div className="card" style={{ marginTop: 16 }}>
          <textarea readOnly value={paperText} style={{ width: "100%", minHeight: 300 }} />
        </div>
      )}
      {(quizActive || quizFinished) && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="quiz-meta">
            <div>
              Question {Math.min(currentIndex + 1, questions.length)} / {questions.length}
            </div>
            <div>Answered: {Object.keys(answers).length}</div>
            <div>Global time: {formatTime(globalTimeLeft)}</div>
            <div>Question time: {formatTime(timeLeft)}</div>
          </div>
          {quizFinished ? (
            <div>
              <div className="status">
                Quiz ended. You answered {Object.keys(answers).length} out of{" "}
                {questions.length} questions.
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={handleSubmitAnswers}
                  disabled={submitting}
                >
                  {submitting ? "Submitting..." : "Submit Answers"}
                </button>
              </div>
              {submissionStatus && (
                <div className={`status ${submissionError ? "error" : ""}`}>
                  {submissionStatus}
                </div>
              )}
            </div>
          ) : (
            questions[currentIndex] && (
              <div>
                <div className="quiz-question">
                  {questions[currentIndex].id}. {questions[currentIndex].question}
                </div>
                <div className="option-list">
                  {questions[currentIndex].options.map((option, index) => (
                    <label key={option} className="option-item">
                      <input
                        type="radio"
                        name={`question-${questions[currentIndex].id}`}
                        checked={answers[questions[currentIndex].id] === index}
                        onChange={() =>
                          setAnswers((prev) => ({
                            ...prev,
                            [questions[currentIndex].id]: index,
                          }))
                        }
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      advanceQuestion();
                      setTimeLeft(60);
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default StudentPage;
