const mongoose = require("mongoose");

const actionLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actor_role: { type: String, enum: ["admin", "student"] },
    exam_id: { type: String },
    metadata: { type: Object },
  },
  { timestamps: true, collection: "action_logs" }
);

module.exports = mongoose.model("ActionLog", actionLogSchema);
