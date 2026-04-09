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

function StudentPage() {
  const [studentExamId, setStudentExamId] = useState("");
  const [studentStatus, setStudentStatus] = useState("");
  const [studentError, setStudentError] = useState(false);
  const [paperText, setPaperText] = useState("");
  const [paperUrl, setPaperUrl] = useState("");

  const epochMs = useMemo(() => new Date(EPOCH_TIME).getTime(), []);

  useEffect(() => {
    return () => {
      if (paperUrl) {
        URL.revokeObjectURL(paperUrl);
      }
    };
  }, [paperUrl]);

  const handlePackageProcess = async (event) => {
    event.preventDefault();
    setStudentStatus("");
    setStudentError(false);
    setPaperText("");
    setPaperUrl("");

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

      if (isPdf) {
        const blob = new Blob([plainBytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setPaperUrl(url);
        setStudentStatus("Decryption successful. PDF ready.");
      } else {
        const text = new TextDecoder().decode(plainBytes);
        setPaperText(text);
        setStudentStatus("Decryption successful.");
      }
    } catch (error) {
      setStudentStatus("Access denied or invalid time.");
      setStudentError(true);
    }
  };

  return (
    <div>
      <h1 className="page-title">Student Module</h1>
      <p className="page-subtitle">
        Fetch package by exam ID, verify signature, and decrypt the paper.
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
      {paperText && (
        <div className="card" style={{ marginTop: 16 }}>
          <textarea readOnly value={paperText} style={{ width: "100%", minHeight: 300 }} />
        </div>
      )}
    </div>
  );
}

export default StudentPage;
