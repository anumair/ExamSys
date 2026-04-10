const mongoose = require("mongoose");

const examResultSchema = new mongoose.Schema(
  {
    exam_id: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    student_id: { type: String, required: true },
    submission: { type: mongoose.Schema.Types.ObjectId, ref: "AnswerSubmission" },
    score: { type: Number, required: true },
    total: { type: Number, required: true },
    percentage: { type: Number, required: true },
    verified: { type: Boolean, default: false },
    evaluated_at: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "exam_results" }
);

module.exports = mongoose.model("ExamResult", examResultSchema);
