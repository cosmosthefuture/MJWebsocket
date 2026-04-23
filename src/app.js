import express from "express";
import cors from "cors";
import env from "./config/env.js";
import healthRoute from "./routes/health.js";

const app = express();

app.use(cors({
    origin: env.cors.origins,
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "X-Internal-Secret", "Content-Type"],
    credentials: false,
}));
app.use(express.json());

app.use("/health", healthRoute);

export default app;