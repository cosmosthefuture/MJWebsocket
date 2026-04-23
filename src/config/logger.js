import { createLogger, format, transports } from "winston";

const { combine, timestamp, json } = format;

// 🔥 Filter function
const filterByType = (type) =>
  format((info) => {
    if (info.message?.type === type) {
      return info;
    }
    return false;
  })();

const logger = createLogger({
  level: "info",
  format: combine(timestamp(), json()), // global format

  transports: [
    // console (all logs)
    // new transports.Console(),

    // all logs
    new transports.File({ filename: "src/logs/combined.log" }),

    // only errors
    new transports.File({
      filename: "src/logs/error.log",
      level: "error",
    }),

    // 🔥 API logs
    new transports.File({
      filename: "src/logs/api.log",
      level: "info", // 🔥 add this
      format: combine(
        filterByType("API"),  // 🔥 FILTER FIRST
        timestamp(),
        json()
      ),
    }),

    // 🔥 SOCKET logs
    new transports.File({
      filename: "src/logs/socket.log",
      level: "info", // 🔥 add this
      format: combine(
        filterByType("SOCKET"), // 🔥 FILTER FIRST
        timestamp(),
        json()
      ),
    }),
  ],
});

export default logger;