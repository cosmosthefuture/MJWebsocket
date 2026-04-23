import { Server } from "socket.io";
import socketManager from "../core/socket/socketManager.js";
import socketAuth from "../middlewares/socketAuth.js";
import env from "./env.js";

export function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: env.socket.corsOrigins,
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization", "X-Internal-Secret", "Content-Type"],
      credentials: false,
    },
    transports: ["websocket"],
  });

  io.use(socketAuth);

  socketManager.init(io);
}