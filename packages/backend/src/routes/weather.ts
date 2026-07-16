import { Router } from "express";
import { weatherLimiter } from "../middleware/rateLimit.js";
import {
  fetchForecast,
  fetchWindAloft,
  fetchKpIndex,
} from "../services/weather.js";

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

/**
 * GET /api/weather/wind-aloft?lat=...&lng=...&heightM=...
 *
 * Returns wind speed/direction at the altitude band (80/120/180m) closest
 * to the mission's configured flight height, proxied from Open-Meteo's
 * free forecast API and cached server-side. Supplements MET Norway's
 * Locationforecast, which only reports surface-level wind.
 */
weatherRoutes.get("/wind-aloft", weatherLimiter, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const heightM = Number(req.query.heightM);

  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180 ||
    !Number.isFinite(heightM) ||
    heightM < 0 ||
    heightM > 1000
  ) {
    res.status(400).json({ error: "Neplatné lat/lng/heightM" });
    return;
  }

  try {
    const windAloft = await fetchWindAloft(lat, lng, heightM);
    res.json({ windAloft });
  } catch (err) {
    console.error("Wind-aloft fetch error:", err);
    res
      .status(502)
      .json({ error: "Načtení dat o větru od poskytovatele selhalo" });
  }
});

/**
 * GET /api/weather/kp-index
 *
 * Returns the latest planetary Kp geomagnetic index value, proxied from
 * NOAA SWPC's free public feed and cached server-side. Not location-
 * specific — the Kp index is a single global reading.
 */
weatherRoutes.get("/kp-index", weatherLimiter, async (_req, res) => {
  try {
    const kp = await fetchKpIndex();
    res.json({ kp });
  } catch (err) {
    console.error("Kp-index fetch error:", err);
    res
      .status(502)
      .json({ error: "Načtení Kp indexu od poskytovatele selhalo" });
  }
});
