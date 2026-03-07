import { apiClient } from "./index";

export const submitBookingRating = async (bookingId, stars) => {
  return apiClient.post(`/bookings/${bookingId}/rating`, { stars });
};
