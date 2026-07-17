import { Router } from "express";
import { buildNotamBriefingLink } from "../services/airspace/notam.js";
import { airspaceLimiter } from "../middleware/rateLimit.js";

export const notamRoutes = Router();

/**
 * GET /api/notam?south=...&west=...&north=...&east=...&date=YYYY-MM-DD
 *
 * Returns a best-effort NOTAM briefing deep link for the given bounding box
 * and optional date — see services/airspace/notam.ts for why this is a
 * link-out rather than live data (Czech NOTAMs require an authenticated AIM
 * ČR session, there's no public feed to scrape). No auth required: this
 * doesn't touch user data, it just builds a URL.
 */
notamRoutes.get("/", airspaceLimiter, (req, res) => {
  const { south, west, north, east, date } = req.query;

  if (!south || !west || !north || !east) {
    res.status(400).json({
      error: "Chybí parametry ohraničení: south, west, north, east",
    });
    return;
  }

  const bounds = {
    south: Number(south),
    west: Number(west),
    north: Number(north),
    east: Number(east),
  };

  if (Object.values(bounds).some((v) => !Number.isFinite(v))) {
    res
      .status(400)
      .json({ error: "Parametry ohraničení musí být platná čísla" });
    return;
  }

  const dateParam = typeof date === "string" ? date : undefined;
  const link = buildNotamBriefingLink(bounds, dateParam);
  res.json(link);
});
