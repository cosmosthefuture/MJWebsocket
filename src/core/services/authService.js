import apiClient from "./apiClient.js";

class AuthService {
    async verifyToken(token) {
        try {
            const response = await apiClient.get("/me", {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            return response.data.data; // depends on your Laravel response
        } catch (err) {
            return null;
        }
    }
}

export default new AuthService();