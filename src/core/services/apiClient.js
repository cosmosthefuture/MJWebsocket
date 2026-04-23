import axios from "axios";
import env from "../../config/env.js";

const apiClient = axios.create({
  baseURL: env.api.baseUrl,
  timeout: 5000,
  headers: {
    "X-Internal-Secret": env.api.internalKey, // 👈 add this
  },
});

export default apiClient;