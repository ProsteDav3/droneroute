import { Router } from "express";
import { weatherLimiter } from "../middleware/rateLimit.js";
import { fetchForecast } from "../services/weather.js";

export const weatherRoutes = Router();

/**
 * GET /api/weather/forecast?lat=...&lng=...
 *
 * Returns a weather forecast (temperature, wind, precipitation) for the
 * given coordinates, proxied from MET Norway's free Locationforecast API
 * and cached server-side.
 */
weatherRoutes.get("/forecast", weatherLimiter, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    res.status(400).json({ error: "Neplatné lat/lng" });
    return;
  }

  try {
    const forecast = await fetchForecast(lat, lng);
    res.json({ forecast });
  } catch (err) {
    console.error("Weather fetch error:", err);
    res
      .status(502)
      .json({ error: "Načtení dat o počasí od poskytovatele selhalo" });
  }
});
