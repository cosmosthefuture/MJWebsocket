import logger from "../../../config/logger.js";

export default {
  info(data) {
    logger.info({ game: "mahjong", ...data });
  },

  error(data) {
    logger.error({ game: "mahjong", ...data });
  },
};