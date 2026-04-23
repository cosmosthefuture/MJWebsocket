import "dotenv/config";

import http from "http";
import app from "./app.js";
import { initSocket } from "./config/socket.js";
import logger from "./config/logger.js";
import env from "./config/env.js";

const server = http.createServer(app);

initSocket(server);

server.listen(env.app.port, () => {
    console.log(`Server running on port ${env.app.port}`);
});